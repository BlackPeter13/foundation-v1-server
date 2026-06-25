/*
 *
 * Workers (Updated) – with concurrency limiting & robust error handling
 *
 */

const PoolShares = require('./shares');
const PoolStatistics = require('./statistics');
const PoolStratum = require('./stratum');

////////////////////////////////////////////////////////////////////////////////

// Main Workers Function
const PoolWorkers = function (logger, client) {

  const _this = this;
  process.setMaxListeners(0);

  this.pools = {};
  this.client = client;
  this.poolConfigs = JSON.parse(process.env.poolConfigs || '{}');
  this.portalConfig = JSON.parse(process.env.portalConfig || '{}');
  this.forkId = process.env.forkId;

  // Build a single pool – returns a promise
  this.createPool = async function(configName) {
    try {
      const poolConfig = _this.poolConfigs[configName];
      if (!poolConfig) {
        throw new Error(`Pool config "${configName}" not found.`);
      }

      const poolShares = new PoolShares(logger, _this.client, poolConfig, _this.portalConfig);
      const poolStatistics = new PoolStatistics(logger, _this.client, poolConfig, _this.portalConfig);
      const poolStratum = new PoolStratum(logger, poolConfig, _this.portalConfig, poolShares, poolStatistics);

      // Wrap setupStratum in a promise with a timeout (60 seconds)
      const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Pool "${configName}" startup timed out after 60s`));
        }, 60000);

        poolStratum.setupStratum((response) => {
          clearTimeout(timeout);
          if (response === true) {
            resolve(poolStratum);
          } else {
            reject(new Error(`Pool "${configName}" startup failed: ${response}`));
          }
        });
      });

      return result;
    } catch (err) {
      logger.error('Worker', 'Pool', `Error creating pool "${configName}": ${err.message}`);
      throw err; // rethrow so it can be handled by the caller
    }
  };

  // Start workers with concurrency limiting (batch size = 3)
  this.setupWorkers = function(callback) {
    const poolNames = Object.keys(_this.poolConfigs);
    if (poolNames.length === 0) {
      logger.warning('Worker', 'Init', 'No pool configurations found in this worker.');
      return callback();
    }

    const BATCH_SIZE = 3; // start 3 pools concurrently to avoid overloading daemons
    let index = 0;
    const results = [];

    // Helper to process a batch
    async function processBatch() {
      const batch = poolNames.slice(index, index + BATCH_SIZE);
      index += BATCH_SIZE;

      if (batch.length === 0) return;

      // Start all pools in this batch concurrently
      const promises = batch.map(name => _this.createPool(name));
      const settled = await Promise.allSettled(promises);

      // Process results
      settled.forEach((result, i) => {
        const poolName = batch[i];
        if (result.status === 'fulfilled') {
          const poolStratum = result.value;
          _this.pools[poolName] = poolStratum;
          logger.info('Worker', poolName, `Pool started successfully.`);
        } else {
          logger.error('Worker', poolName, `Pool failed to start: ${result.reason.message}`);
        }
      });

      // If there are more pools, continue with next batch
      if (index < poolNames.length) {
        // Small delay between batches to let daemons breathe
        await new Promise(resolve => setTimeout(resolve, 1000));
        await processBatch();
      }
    }

    // Start processing
    processBatch()
      .then(() => {
        logger.info('Worker', 'Init', `Finished starting pools. ${Object.keys(_this.pools).length}/${poolNames.length} pools running.`);
        callback();
      })
      .catch((err) => {
        logger.error('Worker', 'Init', `Unexpected error in pool startup: ${err.message}`);
        callback(err);
      });
  };
};

module.exports = PoolWorkers;
