/*
 *
 * Loader (Updated)
 *
 * Loads pool configurations from the configs/pools/ directory.
 * Emits log events via the provided logger.
 */

const fs = require('fs');
const path = require('path');
const events = require('events');

// -----------------------------------------------------------------------------

class PoolLoader extends events.EventEmitter {

  /**
   * @param {Object} logger - A logger instance with .info(), .warn(), .error() methods.
   */
  constructor(logger) {
    super();
    this.logger = logger || console;
    this.poolConfigs = [];
  }

  /**
   * Build pool configurations from all .js and .json files in the pools directory.
   * @param {string} poolsDir - Path to the pools directory (optional – defaults to ../configs/pools/).
   * @param {Object} baseConfig - Base configuration (from main config) to merge.
   * @returns {Array} Array of pool config objects.
   */
  buildPoolConfigs(poolsDir, baseConfig) {
    const log = this.logger;

    // ---- FIX: set default if undefined or empty ----
    if (!poolsDir || typeof poolsDir !== 'string') {
      // Default: assume loader.js is in scripts/main/, so configs/pools/ is two levels up
      const defaultPath = path.join(__dirname, '../../configs/pools');
      const msg = `Pools directory not provided, using default: ${defaultPath}`;
      if (log && typeof log.warn === 'function') {
        log.warn('Loader', 'Warning', msg);
      } else {
        console.warn('[Loader/Warning]', msg);
      }
      poolsDir = defaultPath;
    }

    // Ensure the directory exists
    if (!fs.existsSync(poolsDir)) {
      const msg = `Pools directory not found: ${poolsDir}`;
      if (log && typeof log.error === 'function') {
        log.error('Loader', 'Error', msg);
      } else {
        console.error('[Loader/Error]', msg);
      }
      return [];
    }

    const files = fs.readdirSync(poolsDir).filter(file => {
      return file.endsWith('.js') || file.endsWith('.json');
    });

    if (files.length === 0) {
      const msg = 'No pool configuration files found in ' + poolsDir;
      if (log && typeof log.warn === 'function') {
        log.warn('Loader', 'Warning', msg);
      } else {
        console.warn('[Loader/Warning]', msg);
      }
      return [];
    }

    for (const file of files) {
      const fullPath = path.join(poolsDir, file);
      try {
        let poolConfig;

        if (file.endsWith('.json')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          poolConfig = JSON.parse(content);
        } else {
          // .js file – require it
          delete require.cache[require.resolve(fullPath)];
          poolConfig = require(fullPath);
          if (typeof poolConfig === 'function') {
            poolConfig = poolConfig(baseConfig);
          }
        }

        // Merge with baseConfig (if provided)
        if (baseConfig && typeof baseConfig === 'object') {
          poolConfig = Object.assign({}, baseConfig, poolConfig);
        }

        // Validate essential fields
        if (!poolConfig.name || !poolConfig.primary || !poolConfig.primary.address) {
          const msg = `Pool config in ${file} is missing required fields (name, primary.address)`;
          if (log && typeof log.warn === 'function') {
            log.warn('Loader', 'Warning', msg);
          } else {
            console.warn('[Loader/Warning]', msg);
          }
          continue;
        }

        this.poolConfigs.push(poolConfig);

        const logMsg = `Loaded pool ${poolConfig.name} from ${file}`;
        if (log && typeof log.info === 'function') {
          log.info('Builder', 'Setup', logMsg);
        } else {
          console.log('[Builder/Setup]', logMsg);
        }

      } catch (err) {
        const msg = `Error loading pool config from ${file}: ${err.message}`;
        if (log && typeof log.error === 'function') {
          log.error('Loader', 'Error', msg);
        } else {
          console.error('[Loader/Error]', msg);
        }
        // Continue to next file
      }
    }

    return this.poolConfigs;
  }

  /**
   * Get the loaded pool configs.
   * @returns {Array}
   */
  getPoolConfigs() {
    return this.poolConfigs;
  }

  /**
   * Clear loaded configs (useful for hot‑reload).
   */
  clear() {
    this.poolConfigs = [];
  }
}

module.exports = PoolLoader;
