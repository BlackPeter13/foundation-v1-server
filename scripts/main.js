/*
 *
 * Main entry – scripts/main.js
 *
 */

const path = require('path');

const PoolDatabase = require('./main/database');
const PoolLoader = require('./main/loader');
const PoolLogger = require('./main/logger');
const PoolBuilder = require('./main/builder');

// ----------------------------------------------------------------------
// 1. Load portal config (adjust path if needed)
// ----------------------------------------------------------------------
let config;
try {
  config = require('../configs/main/config.js');
} catch (e) {
  console.error('Unable to find config.js. Read installation instructions.');
  process.exit(1);
}

// ----------------------------------------------------------------------
// 2. Setup logger
// ----------------------------------------------------------------------
const logger = new PoolLogger(config);

// ----------------------------------------------------------------------
// 3. Setup database (Redis)
// ----------------------------------------------------------------------
const database = new PoolDatabase(config);
const loader = new PoolLoader(logger, config);

// Validate TLS if needed
if ((config.redis.tls || config.server.tls) && !loader.validatePortalTLS(config)) {
  throw new Error('Invalid TLS files.');
}

const client = database.buildRedisClient({ detect_buffers: true });
client.on('error', () => {
  throw new Error('Redis connection failed.');
});
database.checkRedisClient(client);

// ----------------------------------------------------------------------
// 4. Load and validate pool configurations
// ----------------------------------------------------------------------
const poolConfigs = loader.buildPoolConfigs();
if (Object.keys(poolConfigs).length === 0) {
  logger.error('Main', 'Init', 'No pools loaded.');
  process.exit(1);
}
logger.info('Main', 'Init', `Loaded ${Object.keys(poolConfigs).length} pool(s).`);

// ----------------------------------------------------------------------
// 5. Start the builder (cluster manager)
// ----------------------------------------------------------------------
const builder = new PoolBuilder(logger, config);
builder.poolConfigs = poolConfigs;

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Main', 'Master', 'SIGTERM received – shutting down.');
  builder.shutdown();
});
process.on('SIGINT', () => {
  logger.info('Main', 'Master', 'SIGINT received – shutting down.');
  builder.shutdown();
});

// Global error handlers (keep master alive)
process.on('uncaughtException', (err) => {
  logger.error('Main', 'Master', `Uncaught exception: ${err.stack}`);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Main', 'Master', `Unhandled rejection: ${reason}`);
});

// Start the pool!
logger.info('Main', 'Master', 'Starting pool builder...');
builder.init();
