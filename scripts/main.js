/*
 *
 * Main (Updated)
 *
 * Entry point for the Foundation pool server.
 * Loads configurations, initializes the pool, and starts the stratum server.
 */

const path = require('path');
const fs = require('fs');
const PoolLoader = require('./main/loader');
const Pool = require('foundation-stratum');

// -----------------------------------------------------------------------------
// Logger – minimal fallback if no logger module exists
// -----------------------------------------------------------------------------

// Try to load a custom logger; if not available, use console.
let logger;
try {
  logger = require('./logger');
  if (typeof logger.info !== 'function') {
    // If the logger doesn't have .info, treat it as a plain object and wrap it
    const original = logger;
    logger = {
      info: (...args) => console.log('[INFO]', ...args),
      warn: (...args) => console.warn('[WARN]', ...args),
      error: (...args) => console.error('[ERROR]', ...args),
      debug: (...args) => console.debug('[DEBUG]', ...args),
      ...original
    };
  }
} catch (e) {
  // No logger module – use console with prefixes
  logger = {
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    debug: (...args) => console.debug('[DEBUG]', ...args),
  };
}

// Helper to safely call logger methods (in case they are still missing)
function safeLog(method, ...args) {
  if (logger && typeof logger[method] === 'function') {
    return logger[method](...args);
  }
  // Fallback to console
  const prefix = method.toUpperCase();
  console.log(`[${prefix}]`, ...args);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

const main = async function() {

  // 1. Load main config (configs/main/config.js)
  const mainConfigPath = path.join(__dirname, '../configs/main/config.js');
  let mainConfig;
  try {
    delete require.cache[require.resolve(mainConfigPath)];
    mainConfig = require(mainConfigPath);
    safeLog('info', 'Main', 'Config', `Loaded main config from ${mainConfigPath}`);
  } catch (err) {
    safeLog('error', 'Main', 'Config', `Failed to load main config: ${err.message}`);
    process.exit(1);
  }

  // 2. Load pool configs
  const poolsDir = path.join(__dirname, '../configs/pools');
  const loader = new PoolLoader(logger);
  const poolConfigs = loader.buildPoolConfigs(poolsDir, mainConfig);

  if (!poolConfigs || poolConfigs.length === 0) {
    safeLog('error', 'Main', 'Init', 'No pools loaded. Exiting.');
    process.exit(1);
  }

  // Fixed: use backticks for template literal
  safeLog('info', 'Main', 'Init', `Loaded ${Object.keys(poolConfigs).length} pool(s).`);

  // 3. Initialize each pool
  for (const poolConfig of poolConfigs) {
    try {
      // Create a stratum server for this pool
      // The authorizeFn and responseFn are callbacks – adjust as needed.
      const authorizeFn = function(ip, port, addrPrimary, addrAuxiliary, password, callback) {
        // Basic authorization – you can replace with your own logic
        callback({ error: null, authorized: true });
      };
      const responseFn = function(data) {
        // Handle responses (e.g., send to portal)
        safeLog('debug', 'Pool', 'Response', data);
      };

      const pool = Pool.create(poolConfig, mainConfig.portal || {}, authorizeFn, responseFn);
      safeLog('info', 'Pool', 'Started', `Pool ${poolConfig.name} started successfully.`);
    } catch (err) {
      safeLog('error', 'Pool', 'Start', `Failed to start pool ${poolConfig.name}: ${err.message}`);
    }
  }

  safeLog('info', 'Main', 'Init', 'All pools initialized. Server is running.');
};

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

main().catch((err) => {
  safeLog('error', 'Main', 'Fatal', err.stack || err.message);
  process.exit(1);
});
