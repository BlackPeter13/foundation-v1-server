/*
 *
 * Main (with file watcher for pools)
 *
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const redis = require('redis');
const chokidar = require('chokidar');
const PoolLoader = require('./main/loader');
const Pool = require('foundation-stratum');
const PoolApi = require('./main/api');

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

// ==================== Globals ====================
let mainConfig;
let poolConfigs = {}; // will be object keyed by name
let redisClient;
let app;
let poolInstances = {};
let watcher;

// ==================== Load configs ====================
function loadMainConfig() {
  const mainConfigPath = path.join(__dirname, '../configs/main/config.js');
  try {
    delete require.cache[require.resolve(mainConfigPath)];
    mainConfig = require(mainConfigPath);
    safeLog('info', 'Main', 'Config', `Loaded main config from ${mainConfigPath}`);
  } catch (err) {
    safeLog('error', 'Main', 'Config', `Failed to load main config: ${err.message}`);
    process.exit(1);
  }
}

function loadPoolConfigs() {
  const poolsDir = path.join(__dirname, '../configs/pools');
  const loader = new PoolLoader(logger);
  const poolConfigsArray = loader.buildPoolConfigs(poolsDir, mainConfig);
  const newPoolConfigs = {};
  if (poolConfigsArray && poolConfigsArray.length > 0) {
    poolConfigsArray.forEach(pc => {
      if (pc.name) {
        newPoolConfigs[pc.name] = pc;
      }
    });
  }
  return newPoolConfigs;
}

// ==================== Redis ====================
async function initRedis() {
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
  const client = redis.createClient(redisOptions);
  client.on('error', (err) => safeLog('error', 'Redis', err.message));
  client.on('connect', () => safeLog('info', 'Redis', 'Connected'));
  await client.connect();
  return client;
}

// ==================== Start stratum pools ====================
function startPools(configs) {
  const started = [];
  for (const poolName in configs) {
    const poolConfig = configs[poolName];
    try {
      if (poolInstances[poolName]) {
        // attempt to stop existing pool gracefully? For simplicity, we'll just overwrite.
        // In production you might want to call pool.shutdown() if available.
        // We'll just remove the reference and create a new one.
        delete poolInstances[poolName];
      }
      const authorizeFn = function(ip, port, addrPrimary, addrAuxiliary, password, callback) {
        callback({ error: null, authorized: true });
      };
      const responseFn = function(data) {
        safeLog('debug', 'Pool', 'Response', data);
      };
      const pool = Pool.create(poolConfig, mainConfig.portal || {}, authorizeFn, responseFn);
      poolInstances[poolName] = pool;
      safeLog('info', 'Pool', 'Started', `Pool ${poolConfig.name} started successfully.`);
      started.push(poolName);
    } catch (err) {
      safeLog('error', 'Pool', 'Start', `Failed to start pool ${poolConfig.name}: ${err.message}`);
    }
  }
  return started;
}

// ==================== Setup API ====================
function setupApi() {
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
}

// ==================== File Watcher ====================
function watchPools() {
  const poolsDir = path.join(__dirname, '../configs/pools');
  if (watcher) {
    watcher.close();
  }
  watcher = chokidar.watch(poolsDir, {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
  });

  watcher
    .on('add', (filePath) => handleFileChange('add', filePath))
    .on('change', (filePath) => handleFileChange('change', filePath))
    .on('unlink', (filePath) => handleFileChange('unlink', filePath));

  function handleFileChange(event, filePath) {
    safeLog('info', 'Watcher', `${event} detected on ${path.basename(filePath)}`);
    // Reload configs
    const newPoolConfigs = loadPoolConfigs();
    // Update the global poolConfigs object
    Object.assign(poolConfigs, newPoolConfigs);
    // Also remove any that were deleted
    // For simplicity, we just replace the entire object
    // But we need to keep the reference used by the API. We'll just reassign.
    // Since the API uses the reference, we need to update it.
    // We'll replace the object with a new one and restart pools.
    // But we can't easily replace the object reference used in the API closure.
    // So we'll restart the entire server (or at least re-init API)
    // The easiest: restart the whole node process? Or we can update the poolApi instance.
    // For now, we'll just restart the pools and update the API's config reference.
    // Since the API uses poolConfigs from the closure, we need to update it.
    // We'll use a global variable and refresh.
    // We'll implement a soft restart: re-initialize pools and API.
    safeLog('info', 'Watcher', 'Reloading pool configurations...');
    // Stop current pools (if possible)
    for (const name in poolInstances) {
      try {
        if (typeof poolInstances[name].shutdown === 'function') {
          poolInstances[name].shutdown();
        }
      } catch (e) {}
      delete poolInstances[name];
    }
    // Reload configs
    const freshConfigs = loadPoolConfigs();
    // Replace the global poolConfigs object
    // We need to replace the object's contents, not reassign, because the API uses the reference.
    // So we clear and re-add.
    for (const key in poolConfigs) {
      delete poolConfigs[key];
    }
    for (const key in freshConfigs) {
      poolConfigs[key] = freshConfigs[key];
    }
    // Re-start pools
    startPools(poolConfigs);
    // The API will use the updated poolConfigs object.
    safeLog('info', 'Watcher', 'Reload complete.');
  }
}

// ==================== Main ====================
async function main() {
  loadMainConfig();
  const initialConfigs = loadPoolConfigs();
  if (Object.keys(initialConfigs).length === 0) {
    safeLog('error', 'Main', 'Init', 'No pools loaded. Exiting.');
    process.exit(1);
  }
  // Assign to global poolConfigs
  Object.assign(poolConfigs, initialConfigs);

  redisClient = await initRedis();

  // Create Express app
  app = express();
  const PORT = mainConfig.portal?.port || 3001;
  app.use(cors());
  app.use(express.json());

  // Setup API (uses poolConfigs reference)
  setupApi();

  const publicDir = path.join(__dirname, '../public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    safeLog('info', 'Web', `Serving static files from ${publicDir}`);
  }

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: Date.now() });
  });

  const server = app.listen(PORT, () => {
    safeLog('info', 'Web', `API server listening on http://localhost:${PORT}/api/v1`);
  });

  // Start pools
  startPools(poolConfigs);

  // Start file watcher
  watchPools();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    safeLog('info', 'Main', 'Shutting down...');
    if (watcher) await watcher.close();
    // Close Redis
    if (redisClient) await redisClient.quit();
    // Close HTTP server
    server.close(() => process.exit(0));
    // Force exit after 5s
    setTimeout(() => process.exit(0), 5000);
  });
}

main().catch((err) => {
  safeLog('error', 'Main', 'Fatal', err.stack || err.message);
  process.exit(1);
});
