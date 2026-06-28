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
   * Build pool configurations from all .js and .json files in configs/pools/
   * @param {string} poolsDir - Path to the pools directory.
   * @param {Object} baseConfig - Base configuration (from main config) to merge.
   * @returns {Array} Array of pool config objects.
   */
  buildPoolConfigs(poolsDir, baseConfig) {
    const log = this.logger;

    // Ensure the directory exists
    if (!fs.existsSync(poolsDir)) {
      const msg = `Pools directory not found: ${poolsDir}`;
      if (log && log.error) log.error('Loader', 'Error', msg);
      else console.error('[Loader/Error]', msg);
      return [];
    }

    const files = fs.readdirSync(poolsDir).filter(file => {
      return file.endsWith('.js') || file.endsWith('.json');
    });

    if (files.length === 0) {
      const msg = 'No pool configuration files found in ' + poolsDir;
      if (log && log.warn) log.warn('Loader', 'Warning', msg);
      else console.warn('[Loader/Warning]', msg);
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
          // If it's a function, call it (allows dynamic config generation)
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
          if (log && log.warn) log.warn('Loader', 'Warning', msg);
          else console.warn('[Loader/Warning]', msg);
          continue;
        }

        this.poolConfigs.push(poolConfig);

        // FIXED: correct template literal and fallback if logger.info missing
        const logMsg = `Loaded pool ${poolConfig.name} from ${file}`;
        if (log && typeof log.info === 'function') {
          log.info('Builder', 'Setup', logMsg);
        } else {
          console.log('[Builder/Setup]', logMsg);
        }

      } catch (err) {
        const msg = `Error loading pool config from ${file}: ${err.message}`;
        if (log && log.error) log.error('Loader', 'Error', msg);
        else console.error('[Loader/Error]', msg);
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
