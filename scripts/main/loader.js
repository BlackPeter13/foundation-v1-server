/*
 *
 * Loader (Updated) – with better error handling and port validation
 *
 */

const fs = require('fs');
const path = require('path');
const Algorithms = require('foundation-stratum').algorithms;

////////////////////////////////////////////////////////////////////////////////

// Main Loader Function
const PoolLoader = function(logger, portalConfig) {

  const _this = this;
  this.portalConfig = portalConfig;
  this.poolConfigs = {}; // will hold loaded configs

  // Validate Pool Algorithms
  this.validatePoolAlgorithms = function(algorithm, name) {
    if (!(algorithm in Algorithms)) {
      logger.error('Builder', name, `Cannot run a pool for unsupported algorithm "${ algorithm }"`);
      return false;
    }
    return true;
  };

  // Check for Overlapping Pool Names (uses a Set for efficiency)
  this.validatePoolNames = function(poolConfigs, poolConfig) {
    const name = poolConfig.name;
    if (!name) {
      logger.error('Builder', 'Setup', 'Pool config missing "name" property.');
      return false;
    }
    if (name.split(' ').length > 1) {
      logger.error('Builder', 'Setup', `Pool name "${name}" contains spaces – only single words allowed.`);
      return false;
    }
    if (poolConfigs[name]) {
      logger.error('Builder', 'Setup', `Duplicate pool name "${name}" found.`);
      return false;
    }
    return true;
  };

  // Check for Overlapping Pool Ports (uses a Set)
  this.validatePoolPorts = function(poolConfigs, poolConfig) {
    // Collect all ports from already validated pools
    const usedPorts = new Set();
    Object.values(poolConfigs).forEach(cfg => {
      if (cfg.enabled) {
        cfg.ports.forEach(p => {
          if (p.enabled) {
            usedPorts.add(p.port);
          }
        });
      }
    });

    // Check current pool's ports
    for (const portConfig of poolConfig.ports) {
      if (!portConfig.enabled) continue;
      const port = portConfig.port;
      if (usedPorts.has(port)) {
        logger.error('Builder', 'Setup', `Port ${port} is already used by another pool.`);
        return false;
      }
      if (port === _this.portalConfig.server.port) {
        logger.error('Builder', 'Setup', `Port ${port} conflicts with the server port.`);
        return false;
      }
      if (port === _this.portalConfig.redis.port) {
        logger.error('Builder', 'Setup', `Port ${port} conflicts with the Redis port.`);
        return false;
      }
      usedPorts.add(port);
    }
    return true;
  };

  // Check for Valid Recipient Percentage
  this.validatePoolRecipients = function(poolConfig) {
    if (poolConfig.primary.recipients && poolConfig.primary.recipients.length >= 1) {
      const recipientTotal = poolConfig.primary.recipients.reduce((p_sum, a) => p_sum + a.percentage, 0);
      if (recipientTotal >= 1) {
        logger.error('Builder', 'Setup', `Recipient percentage for ${ poolConfig.name } is ≥ 100%. Check your configuration.`);
        return false;
      } else if (recipientTotal >= 0.4) {
        logger.warning('Builder', 'Setup', `Recipient percentage for ${ poolConfig.name } is > 40%. Are you sure that you configured it properly?`);
        return true;
      }
    }
    return true;
  };

  // Check for Valid Portal TLS Files
  /* istanbul ignore next */
  this.validatePortalTLS = function(portalConfig) {
    const keyExists = fs.existsSync(`./certificates/${ portalConfig.tls.key }`) && portalConfig.tls.key.length >= 1;
    const certExists = fs.existsSync(`./certificates/${ portalConfig.tls.cert }`) && portalConfig.tls.cert.length >= 1;
    const authorityExists = fs.existsSync(`./certificates/${ portalConfig.tls.ca }`) && portalConfig.tls.ca.length >= 1;
    if (!keyExists || !certExists || !authorityExists) {
      logger.error('Builder', 'Setup', 'Invalid key, certificate, or authority file specified for TLS. Check your configuration files.');
      return false;
    }
    return true;
  };

  // Check for Valid Pool TLS Files
  /* istanbul ignore next */
  this.validatePoolTLS = function(poolConfig, portalConfig) {
    const tlsCount = poolConfig.ports
      .filter(config => config.enabled)
      .filter(config => config.tls).length;
    if (tlsCount >= 1) {
      const keyExists = fs.existsSync(`./certificates/${ portalConfig.tls.key }`) && portalConfig.tls.key.length >= 1;
      const certExists = fs.existsSync(`./certificates/${ portalConfig.tls.cert }`) && portalConfig.tls.cert.length >= 1;
      if (!keyExists || !certExists) {
        logger.error('Builder', 'Setup', 'Invalid key or certificate file specified for TLS. Check your configuration files.');
        return false;
      }
    }
    return true;
  };

  // Validate Pool Settings (historical retention)
  this.validatePoolVariables = function(poolConfig) {
    const historicalInterval = poolConfig.statistics.historicalInterval || 1800;
    const historicalWindow = poolConfig.statistics.historicalWindow || 86400;
    if (historicalWindow / historicalInterval >= 50) {
      logger.error('Builder', 'Setup', `Historical retention for ${poolConfig.name} must be limited to ≤ 50 records. Check your configuration.`);
      return false;
    }
    return true;
  };

  // Validate Pool Configs
  this.validatePoolConfigs = function(poolConfig) {
    const name = poolConfig.name;
    if (!poolConfig.enabled) return false;
    if (!_this.validatePoolAlgorithms(poolConfig.primary.coin.algorithms.mining, name)) return false;
    if (!_this.validatePoolAlgorithms(poolConfig.primary.coin.algorithms.block, name)) return false;
    if (!_this.validatePoolAlgorithms(poolConfig.primary.coin.algorithms.coinbase, name)) return false;
    if (!_this.validatePoolVariables(poolConfig)) return false;
    if (!_this.validatePoolRecipients(poolConfig)) return false;
    return true;
  };

  // Build Pool Configurations
  /* istanbul ignore next */
  this.buildPoolConfigs = function() {
    const poolConfigs = {};
    const normalizedPath = path.join(__dirname, '../../configs/pools/');

    // Read all files in the pools directory
    let files;
    try {
      files = fs.readdirSync(normalizedPath);
    } catch (err) {
      logger.error('Builder', 'Setup', `Failed to read pool config directory: ${err.message}`);
      return poolConfigs;
    }

    for (const file of files) {
      const fullPath = path.join(normalizedPath, file);
      // Only process .js files
      if (path.extname(file) !== '.js') continue;
      if (!fs.existsSync(fullPath)) continue; // redundant but safe

      let poolConfig;
      try {
        poolConfig = require(fullPath);
      } catch (err) {
        logger.error('Builder', 'Setup', `Failed to load pool config "${file}": ${err.message}`);
        continue;
      }

      // Basic existence checks
      if (!poolConfig || typeof poolConfig !== 'object') {
        logger.error('Builder', 'Setup', `Pool config "${file}" did not export an object.`);
        continue;
      }

      // Validate the config
      if (!_this.validatePoolConfigs(poolConfig)) continue;
      if (!_this.validatePoolTLS(poolConfig, _this.portalConfig)) continue;
      if (!_this.validatePoolNames(poolConfigs, poolConfig)) continue;
      if (!_this.validatePoolPorts(poolConfigs, poolConfig)) continue;

      // Store it
      poolConfigs[poolConfig.name] = poolConfig;
      logger.info('Builder', 'Setup', `Loaded pool "${poolConfig.name}" from ${file}`);
    }

    _this.poolConfigs = poolConfigs;
    return poolConfigs;
  };
};

module.exports = PoolLoader;
