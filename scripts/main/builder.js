/*
 *
 * Builder (Updated) – with robust worker monitoring & backoff
 *
 */

const cluster = require('cluster');
const utils = require('./utils');

////////////////////////////////////////////////////////////////////////////////

// Main Builder Function
const PoolBuilder = function(logger, portalConfig) {

  const _this = this;
  this.portalConfig = portalConfig;
  this.roundCounter = utils.extraNonceCounter(4);

  // Ensure poolConfigs is loaded (assumes it's set elsewhere, but we'll keep a reference)
  // In the original, this.poolConfigs is set from outside; we'll keep it as is.
  // If not set, we'll read from portalConfig if available.
  if (!this.poolConfigs && portalConfig.pools) {
    this.poolConfigs = portalConfig.pools;
  }

  // Track restart attempts per worker type to implement backoff
  this.restartAttempts = {
    payments: 0,
    server: 0,
    workers: {} // forkId -> attempt count
  };

  // ==================== HELPER: Restart with backoff ====================

  function scheduleRestart(workerType, restartFn, forkId) {
    const key = forkId !== undefined ? forkId : workerType;
    if (!_this.restartAttempts[key]) {
      _this.restartAttempts[key] = 0;
    }
    const attempts = _this.restartAttempts[key];
    // Exponential backoff: 2s, 4s, 8s, 16s, 32s, then cap at 60s
    let delay = Math.min(2000 * Math.pow(2, attempts), 60000);
    // Add some jitter to avoid all workers restarting at the same time
    delay += Math.random() * 1000;

    if (attempts > 10) {
      logger.error('Builder', workerType, `Too many restarts (${attempts}) for ${forkId !== undefined ? 'fork '+forkId : workerType}. Giving up.`);
      return;
    }

    logger.error('Builder', workerType, `Restarting ${forkId !== undefined ? 'fork '+forkId : workerType} in ${delay/1000}s (attempt ${attempts+1})`);
    setTimeout(() => {
      _this.restartAttempts[key] += 1;
      restartFn();
    }, delay);
  }

  // ==================== POOL PAYMENTS ====================

  /* istanbul ignore next */
  this.setupPoolPayments = function() {
    // Check if any pool has payments enabled
    let enabled = false;
    Object.keys(_this.poolConfigs).forEach(pool => {
      const poolConfig = _this.poolConfigs[pool];
      if (poolConfig.enabled && poolConfig.primary.payments && poolConfig.primary.payments.enabled) {
        enabled = true;
      }
    });
    if (!enabled) return;

    const worker = cluster.fork({
      workerType: 'payments',
      poolConfigs: JSON.stringify(_this.poolConfigs),
      portalConfig: JSON.stringify(_this.portalConfig)
    });

    worker.on('exit', (code, signal) => {
      logger.error('Master', 'Payments', `Payment process died (code ${code}, signal ${signal}). Restarting...`);
      scheduleRestart('payments', () => _this.setupPoolPayments());
    });

    worker.on('error', (err) => {
      logger.error('Master', 'Payments', `Payment process error: ${err.message}`);
    });

    logger.info('Master', 'Payments', `Started payment worker (PID ${worker.process.pid})`);
  };

  // ==================== POOL SERVER ====================

  /* istanbul ignore next */
  this.setupPoolServer = function() {
    const worker = cluster.fork({
      workerType: 'server',
      poolConfigs: JSON.stringify(_this.poolConfigs),
      portalConfig: JSON.stringify(_this.portalConfig)
    });

    worker.on('exit', (code, signal) => {
      logger.error('Master', 'Server', `Server process died (code ${code}, signal ${signal}). Restarting...`);
      scheduleRestart('server', () => _this.setupPoolServer());
    });

    worker.on('error', (err) => {
      logger.error('Master', 'Server', `Server process error: ${err.message}`);
    });

    logger.info('Master', 'Server', `Started API server worker (PID ${worker.process.pid})`);
  };

  // ==================== POOL WORKERS ====================

  /* istanbul ignore next */
  this.createPoolWorker = function(poolWorkers, forkId) {
    const worker = cluster.fork({
      workerType: 'worker',
      poolConfigs: JSON.stringify(_this.poolConfigs),
      portalConfig: JSON.stringify(_this.portalConfig),
      forkId: forkId,
    });

    worker.forkId = forkId;
    worker.type = 'worker';
    poolWorkers[forkId] = worker;

    worker.on('exit', (code, signal) => {
      logger.error('Builder', 'Workers', `Fork ${forkId} died (code ${code}, signal ${signal}). Restarting...`);
      scheduleRestart('workers', () => _this.createPoolWorker(poolWorkers, forkId), forkId);
    });

    worker.on('error', (err) => {
      logger.error('Builder', 'Workers', `Fork ${forkId} error: ${err.message}`);
    });

    logger.info('Builder', 'Workers', `Started fork ${forkId} (PID ${worker.process.pid})`);
  };

  /* istanbul ignore next */
  this.setupPoolWorkers = function() {
    const poolWorkers = {};
    let numWorkers = 0;

    // Filter out invalid pools
    Object.keys(_this.poolConfigs).forEach(config => {
      const pool = _this.poolConfigs[config];
      if (!pool.enabled) {
        delete _this.poolConfigs[config];
        return;
      }
      if (!Array.isArray(pool.primary.daemons) || pool.primary.daemons.length < 1) {
        logger.error('Builder', config, 'No daemons configured – removing pool.');
        delete _this.poolConfigs[config];
      }
    });

    const numForks = utils.countProcessForks(_this.portalConfig);
    if (numForks === 0) {
      logger.warning('Builder', 'Workers', 'No forks configured – starting 1 worker as fallback.');
      // fallback: start at least one
      numForks = 1;
    }

    if (Object.keys(_this.poolConfigs).length === 0) {
      logger.warning('Builder', 'Workers', 'No valid pool configs remain. No workers started.');
      return;
    }

    // Start workers with a staggered delay to avoid CPU spikes
    const startInterval = setInterval(() => {
      if (numWorkers >= numForks) {
        clearInterval(startInterval);
        logger.debug('Builder', 'Workers', `Started ${Object.keys(_this.poolConfigs).length} pool(s) on ${numForks} thread(s)`);
        return;
      }
      _this.createPoolWorker(poolWorkers, numWorkers);
      numWorkers++;
    }, 250);

    // Store reference for graceful shutdown
    _this._poolWorkers = poolWorkers;
  };

  // ==================== GRACEFUL SHUTDOWN ====================

  /* istanbul ignore next */
  this.shutdown = function() {
    logger.info('Builder', 'Master', 'Shutting down pool workers gracefully...');
    if (_this._poolWorkers) {
      Object.values(_this._poolWorkers).forEach(worker => {
        if (worker.isConnected()) {
          worker.disconnect();
          setTimeout(() => {
            if (worker.isConnected()) {
              worker.kill('SIGTERM');
            }
          }, 5000);
        }
      });
    }
    // Also kill server and payment workers if they exist (we don't have direct refs, but cluster will handle)
    // We'll rely on cluster.disconnect and timeout
    setTimeout(() => {
      process.exit(0);
    }, 6000);
  };

  // ==================== INITIALIZE ====================

  /* istanbul ignore next */
  this.init = function() {
    // Set up signal handlers
    process.on('SIGTERM', () => _this.shutdown());
    process.on('SIGINT', () => _this.shutdown());

    // Log startup
    logger.info('Builder', 'Master', `Starting pool builder with ${Object.keys(_this.poolConfigs).length} pools configured.`);

    // Start processes
    _this.setupPoolServer();
    _this.setupPoolPayments();
    _this.setupPoolWorkers();
  };
};

module.exports = PoolBuilder;
