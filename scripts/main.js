/*
 *
 * Main (Updated) – using optimized PoolBuilder
 *
 */

const path = require('path');

const PoolDatabase = require('./main/database');
const PoolLoader = require('./main/loader');
const PoolLogger = require('./main/logger');
const PoolBuilder = require('./main/builder'); // <-- REPLACED threads with builder

////////////////////////////////////////////////////////////////////////////////

let config;
const normalizedPath = path.join(__dirname, '../configs/main/config.js');

// Check to Ensure Config Exists
try {
  config = require(normalizedPath);
} catch(e) {
  throw new Error('Unable to find config.js file. Read the installation/setup instructions.');
}

const logger = new PoolLogger(config);
const database = new PoolDatabase(config);
const loader = new PoolLoader(logger, config);

// Check for Valid TLS Files
if ((config.redis.tls || config.server.tls) && !loader.validatePortalTLS(config)) {
  throw new Error('Unable to find or validate TLS files. Read the tutorial in the \'./certificates\' folder.');
}

// Build Database Client
const client = database.buildRedisClient({ detect_buffers: true });

// Check for Redis Connection Errors
client.on('error', () => {
  throw new Error('Unable to establish database connection. Ensure Redis is setup properly and listening.');
});

// Check Redis Version
database.checkRedisClient(client);

// -------------------------------------------------------------------------
// LOAD POOL CONFIGURATIONS (using the loader)
// -------------------------------------------------------------------------
const poolConfigs = loader.buildPoolConfigs();

if (Object.keys(poolConfigs).length === 0) {
  logger.error('Main', 'Init', 'No valid pool configurations found. Exiting.');
  process.exit(1);
}

logger.info('Main', 'Init', `Loaded ${Object.keys(poolConfigs).length} pool(s).`);

// -------------------------------------------------------------------------
// START THE BUILDER (cluster manager)
// -------------------------------------------------------------------------
const builder = new PoolBuilder(logger, config);
builder.poolConfigs = poolConfigs;  // attach loaded configs

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Main', 'Master', 'Received SIGTERM, shutting down...');
  builder.shutdown();
});
process.on('SIGINT', () => {
  logger.info('Main', 'Master', 'Received SIGINT, shutting down...');
  builder.shutdown();
});

// Uncaught exceptions – keep master alive
process.on('uncaughtException', (err) => {
  logger.error('Main', 'Master', `Uncaught exception: ${err.message}\n${err.stack}`);
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Main', 'Master', `Unhandled rejection: ${reason}`);
});

// Start the pool!
logger.info('Main', 'Master', 'Starting pool builder...');
builder.init();
