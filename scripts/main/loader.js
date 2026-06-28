/*
 *
 * Loader (Updated)
 *
 * Loads pool configurations from the configs/pools/ directory.
 * Skips:
 *   - Files with "example" in the name (templates)
 *   - Pools with `enabled: false` or `disabled: true`
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
   * @returns {Array} Array of pool config objects (only enabled, non‑example ones).
   */
  buildPoolConfigs(poolsDir, baseConfig) {
    const log = this.logger;

    // ---- Set default if undefined or empty ----
    if (!poolsDir || typeof poolsDir !== 'string') {
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

    let loadedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      const fullPath = path.join(poolsDir, file);
      const baseName = path.basename(file, path.extname(file));

      // ---- 1. Skip example/template files ----
      if (baseName.toLowerCase().includes('example')) {
        const msg = `Skipping example/template file: ${file}`;
        if (log && typeof log.info === 'function') {
          log.info('Loader', 'Skipped', msg);
        } else {
          console.log('[Loader/Skipped]', msg);
        }
        skippedCount++;
        continue;
      }

      // ---- 2. Try to load the config ----
      let poolConfig;
      try {
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
      } catch (err) {
        const msg = `Error loading pool config from ${file}: ${err.message}`;
        if (log && typeof log.error === 'function') {
          log.error('Loader', 'Error', msg);
        } else {
          console.error('[Loader/Error]', msg);
        }
        continue;
      }

      // Merge with baseConfig (if provided)
      if (baseConfig && typeof baseConfig === 'object') {
        poolConfig = Object.assign({}, baseConfig, poolConfig);
      }

      // ---- 3. Check if the pool is explicitly disabled ----
      const isEnabled = poolConfig.enabled !== undefined ? poolConfig.enabled : true;
      const isDisabled = poolConfig.disabled === true;

      if (!isEnabled || isDisabled) {
        const name = poolConfig.name || file;
        const msg = `Skipping disabled pool: ${name}`;
        if (log && typeof log.info === 'function') {
          log.info('Loader', 'Skipped', msg);
        } else {
          console.log('[Loader/Skipped]', msg);
        }
        skippedCount++;
        continue;
      }

      // ---- 4. Validate essential fields ----
      if (!poolConfig.name || !poolConfig.primary || !poolConfig.primary.address) {
        const msg = `Pool config in ${file} is missing required fields (name, primary.address)`;
        if (log && typeof log.warn === 'function') {
          log.warn('Loader', 'Warning', msg);
        } else {
          console.warn('[Loader/Warning]', msg);
        }
        continue;
      }

      // ---- 5. Pool is valid – add it ----
      this.poolConfigs.push(poolConfig);
      loadedCount++;

      const logMsg = `Loaded pool ${poolConfig.name} from ${file}`;
      if (log && typeof log.info === 'function') {
        log.info('Builder', 'Setup', logMsg);
      } else {
        console.log('[Builder/Setup]', logMsg);
      }
    }

    // ---- Summary ----
    const summary = `Loaded ${loadedCount} pool(s), skipped ${skippedCount} disabled/example pool(s).`;
    if (log && typeof log.info === 'function') {
      log.info('Loader', 'Summary', summary);
    } else {
      console.log('[Loader/Summary]', summary);
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
