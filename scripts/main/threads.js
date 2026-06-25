/*
 *
 * Threads (Updated) – Bootstrap for the optimized builder architecture
 *
 */

const path = require('path');

const PoolDatabase = require('./database');
const PoolLoader = require('./loader');
const PoolLogger = require('./logger');
const PoolBuilder = require('./builder');

////////////////////////////////////////////////////////////////////////////////

// This class is kept for backward compatibility; you can call PoolThreads.start()
const PoolThreads = function() {
  // No-op constructor; the static start() method does the work
};

// Static method to start the entire pool
PoolThreads.start = function() {
  // 1. Load portal config
  let config;
  const configPath = path.join(__dirname, '../../configs/main/config.js');
  try {
    config = require(configPath);
  } catch (e) {
    throw new Error('Unable to find config.js file. Read the installation/setup instructions.');
  }

  // 2. Setup logger
  const logger = new PoolLogger(config);

  // 3. Setup database (Redis)
  const database = new PoolDatabase(config);
  const loader = new PoolLoader(logger, config);

  // 4. Validate TLS if needed
  if ((config.redis.tls || config.server.tls) && !loader.validatePortalTLS(config)) {
    throw new Error('Unable to find or validate TLS files. Read the tutorial in the \'./certificates\' folder.');
  }

  // 5. Build Redis client
  const client = database.buildRedisClient({ detect_buffers: true });
  client.on('error', () => {
    throw new Error('Unable to establish database connection. Ensure Redis is setup properly and listening.');
  });
  database.checkRedisClient(client);

  // 6. Load and validate pool configurations
  const poolConfigs = loader.buildPoolConfigs();
  if (Object.keys(poolConfigs).length === 0) {
    logger.error('Main', 'Init', 'No valid pool configurations found. Exiting.');
    process.exit(1);
  }
  logger.info('Main', 'Init', `Loaded ${Object.keys(poolConfigs).length} pool(s).`);

  // 7. Instantiate the builder and attach configs
  const builder = new PoolBuilder(logger, config);
  builder.poolConfigs = poolConfigs;

  // 8. Graceful shutdown handlers
  process.on('SIGTERM', () => {
    logger.info('Main', 'Master', 'Received SIGTERM, shutting down...');
    builder.shutdown();
  });
  process.on('SIGINT', () => {
    logger.info('Main', 'Master', 'Received SIGINT, shutting down...');
    builder.shutdown();
  });

  // 9. Global error handlers (keep master alive)
  process.on('uncaughtException', (err) => {
    logger.error('Main', 'Master', `Uncaught exception: ${err.message}\n${err.stack}`);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Main', 'Master', `Unhandled rejection: ${reason}`);
  });

  // 10. Start the pool!
  logger.info('Main', 'Master', 'Starting pool builder...');
  builder.init();
};

module.exports = PoolThreads;
