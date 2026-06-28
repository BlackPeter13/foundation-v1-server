/*
 *
 * Main (Updated with API server)
 *
 * Entry point for the Foundation pool server.
 * Loads configurations, initializes Redis, starts the HTTP API,
 * and launches the stratum server(s).
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const redis = require('redis');
const PoolLoader = require('./main/loader');
const Pool = require('foundation-stratum');
const PoolApi = require('./main/api');

// -----------------------------------------------------------------------------
// Logger – minimal fallback
// -----------------------------------------------------------------------------

let logger;
try {
  logger = require('./logger');
  if (typeof logger.info !== 'function') {
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
  logger = {
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    debug: (...args) => console.debug('[DEBUG]', ...args),
  };
}

function safeLog(method, ...args) {
  if (logger && typeof logger[method] === 'function') {
    return logger[method](...args);
  }
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

  safeLog('info', 'Main', 'Init', `Loaded ${poolConfigs.length} pool(s).`);

  // 3. Initialize Redis
  const redisOptions = {
    host: mainConfig.redis?.host || '127.0.0.1',
    port: mainConfig.redis?.port || 6379,
    password: mainConfig.redis?.password || undefined,
    retry_strategy: function(options) {
      if (options.error && options.error.code === 'ECONNREFUSED') {
        safeLog('error', 'Redis', 'Connection refused – retrying in 5s');
        return 5000;
      }
      if (options.total_retry_time > 60000) {
        safeLog('error', 'Redis', 'Retry time exhausted');
        return new Error('Redis retry time exhausted');
      }
      if (options.attempt > 10) {
        safeLog('error', 'Redis', 'Max retry attempts reached');
        return new Error('Redis max retry attempts reached');
      }
      return Math.min(options.attempt * 100, 3000);
    },
    socket_keepalive: true,
    socket_keepalive_initial_delay: 30000,
  };

  const redisClient = redis.createClient(redisOptions);
  redisClient.on('error', (err) => safeLog('error', 'Redis', err.message));
  redisClient.on('connect', () => safeLog('info', 'Redis', 'Connected'));
  await redisClient.connect();

  // 4. Create Express app
  const app = express();
  const PORT = mainConfig.portal?.port || 3001;

  // Enable CORS for all routes (so frontend can access from different port)
  app.use(cors());

  // JSON body parser (if needed)
  app.use(express.json());

  // 5. Mount the API
  const poolApi = new PoolApi(redisClient, poolConfigs, mainConfig.portal || {});

  app.use('/api/v1', (req, res) => {
    const pathParts = req.path.split('/').filter(Boolean);
    const pool = pathParts[0] || '';
    const endpoint = pathParts[1] || '';
    const method = req.query.method || '';

    req.params = { pool, endpoint };
    req.query = { method };

    poolApi.handleApiV1(req, (statusCode, body) => {
      res.status(statusCode).json(body);
    });
  });

  // Optional: serve static frontend if you place it in 'public/'
  const publicDir = path.join(__dirname, '../public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    safeLog('info', 'Web', `Serving static files from ${publicDir}`);
  }

  // Health check
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: Date.now() });
  });

  // Start Express server
  app.listen(PORT, () => {
    safeLog('info', 'Web', `API server listening on http://localhost:${PORT}/api/v1`);
  });

  // 6. Start the stratum pools
  for (const poolConfig of poolConfigs) {
    try {
      const authorizeFn = function(ip, port, addrPrimary, addrAuxiliary, password, callback) {
        // Basic authorization – replace with your own logic
        callback({ error: null, authorized: true });
      };
      const responseFn = function(data) {
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
