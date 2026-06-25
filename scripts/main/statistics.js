/*
 *
 * Statistics (Updated) – with SCAN‑based iteration
 *
 */

const utils = require('./utils');
const Algorithms = require('foundation-stratum').algorithms;

////////////////////////////////////////////////////////////////////////////////

// Main Statistics Function
const PoolStatistics = function (logger, client, poolConfig, portalConfig) {

  const _this = this;
  process.setMaxListeners(0);

  this.pool = poolConfig.name;
  this.client = client;
  this.poolConfig = poolConfig;
  this.portalConfig = portalConfig;
  this.forkId = process.env.forkId;

  const logSystem = 'Pool';
  const logComponent = poolConfig.name;
  const logSubCat = `Thread ${ parseInt(_this.forkId) + 1 }`;

  // Current Statistics Intervals
  _this.blocksInterval = _this.poolConfig.statistics.blocksInterval || 20;
  _this.hashrateInterval = _this.poolConfig.statistics.hashrateInterval || 20;
  _this.historicalInterval = _this.poolConfig.statistics.historicalInterval || 1800;
  _this.refreshInterval = _this.poolConfig.statistics.refreshInterval || 20;
  _this.paymentsInterval = _this.poolConfig.statistics.paymentsInterval || 20;

  // Current Statistics Windows
  _this.hashrateWindow = _this.poolConfig.statistics.hashrateWindow || 300;
  _this.historicalWindow = _this.poolConfig.statistics.historicalWindow || 86400;

  // ====================== SCAN‑BASED HELPERS ======================

  // Non‑blocking scan over a set (returns all members as array)
  function scanSetAsync(key, pattern = '*', count = 100) {
    return new Promise((resolve, reject) => {
      const stream = client.sscanStream(key, { match: pattern, count });
      const members = [];
      stream.on('data', (chunk) => { members.push(...chunk); });
      stream.on('end', () => { resolve(members); });
      stream.on('error', reject);
    });
  }

  // Non‑blocking scan over a sorted set (returns all members with scores as array of [member, score])
  function scanZSetAsync(key, count = 100) {
    return new Promise((resolve, reject) => {
      const stream = client.zscanStream(key, { count });
      const items = [];
      stream.on('data', (chunk) => {
        // chunk is [member1, score1, member2, score2, ...]
        for (let i = 0; i < chunk.length; i += 2) {
          items.push({ member: chunk[i], score: chunk[i+1] });
        }
      });
      stream.on('end', () => { resolve(items); });
      stream.on('error', reject);
    });
  }

  // Batch delete helper (splits array into chunks of 1000)
  function batchDelete(commands, key, items, fieldExtractor) {
    const batchSize = 1000;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      if (fieldExtractor) {
        // For sets: srem key member1 member2 ...
        const args = [key, ...batch.map(fieldExtractor)];
        commands.push(['srem', ...args]);
      } else {
        // For sorted sets: zrem key member1 member2 ...
        const args = [key, ...batch.map(item => item.member)];
        commands.push(['zrem', ...args]);
      }
    }
  }

  // ====================== ORIGINAL FUNCTIONS (modified) ======================

  // Calculate Historical Information (unchanged)
  this.calculateHistoricalInfo = function(results, blockType) {
    const commands = [];
    const dateNow = Date.now();
    const algorithm = _this.poolConfig.primary.coin.algorithms.mining;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;

    const output = {
      time: dateNow,
      hashrate: {
        shared: (multiplier * utils.processWork(results[1])) / _this.hashrateWindow,
        solo: (multiplier * utils.processWork(results[2])) / _this.hashrateWindow,
      },
      network: {
        difficulty: parseFloat((results[0] || {}).difficulty || 0),
        hashrate: parseFloat((results[0] || {}).hashrate || 0),
      },
      status: {
        miners: utils.combineMiners(results[1], results[2]),
        workers: utils.combineWorkers(results[1], results[2]),
      },
    };

    commands.push(['zadd', `${ _this.pool }:statistics:${ blockType }:historical`, dateNow / 1000 | 0, JSON.stringify(output)]);
    return commands;
  };

  // Handle Blocks Information – now uses SSCAN
  this.handleBlocksInfo = async function(blockType, callback, handler) {
    try {
      const key = `${ _this.pool }:blocks:${ blockType }:confirmed`;
      // Get all members using non‑blocking SSCAN
      const members = await scanSetAsync(key);
      // Sort by timestamp (assuming each member is JSON with a 'time' field)
      const sorted = members
        .map(m => { try { return JSON.parse(m); } catch(e) { return null; } })
        .filter(b => b !== null)
        .sort((a, b) => a.time - b.time);

      if (sorted.length > 100) {
        const toRemove = sorted.slice(0, sorted.length - 100);
        // Prepare batch srem commands
        const commands = [];
        batchDelete(commands, key, toRemove, (item) => JSON.stringify(item));
        // Execute the deletions
        if (commands.length > 0) {
          _this.executeCommands(commands, () => {
            if (_this.poolConfig.debug) {
              logger.debug('Statistics', _this.pool, `Finished updating blocks statistics for ${ blockType } configuration.`);
            }
            callback([]);
          }, handler);
        } else {
          callback([]);
        }
      } else {
        callback([]);
      }
    } catch (err) {
      logger.error(logSystem, logComponent, logSubCat, `Error in handleBlocksInfo: ${ err.message }`);
      handler(err);
    }
  };

  // Handle Hashrate Information (already efficient – unchanged)
  this.handleHashrateInfo = function(blockType, callback) {
    const commands = [];
    const windowTime = (((Date.now() / 1000) - _this.hashrateWindow) | 0).toString();
    commands.push(['zremrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:shared:hashrate`, 0, `(${ windowTime }`]);
    commands.push(['zremrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:solo:hashrate`, 0, `(${ windowTime }`]);
    callback(commands);
  };

  // Get Historical Information (unchanged)
  this.handleHistoricalInfo = function(blockType, callback, handler) {
    const windowTime = (((Date.now() / 1000) - _this.hashrateWindow) | 0).toString();
    const windowHistorical = (((Date.now() / 1000) - _this.historicalWindow) | 0).toString();
    const historicalLookups = [
      ['hgetall', `${ _this.pool }:statistics:${ blockType }:network`],
      ['zrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:shared:hashrate`, windowTime, '+inf'],
      ['zrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:solo:hashrate`, windowTime, '+inf'],
      ['zremrangebyscore', `${ _this.pool }:statistics:${ blockType }:historical`, 0, `(${ windowHistorical }`]
    ];
    _this.executeCommands(historicalLookups, (results) => {
      const commands = _this.calculateHistoricalInfo(results, blockType);
      callback(commands);
    }, handler);
  };

  // Get Mining Statistics (unchanged)
  this.handleMiningInfo = function(daemon, blockType, callback, handler) {
    const commands = [];
    daemon.cmd('getmininginfo', [], true, (result) => {
      if (result.error) {
        logger.error('Statistics', _this.pool, `Error with statistics daemon: ${ JSON.stringify(result.error) }`);
        handler(result.error);
      } else {
        const data = result.response;
        commands.push(['hset', `${ _this.pool }:statistics:${ blockType }:network`, 'difficulty', data.difficulty]);
        commands.push(['hset', `${ _this.pool }:statistics:${ blockType }:network`, 'hashrate', data.networkhashps]);
        commands.push(['hset', `${ _this.pool }:statistics:${ blockType }:network`, 'height', data.blocks]);
        callback(commands);
      }
    });
  };

  // Handle Payments Information – now uses ZSCAN
  this.handlePaymentsInfo = async function(blockType, callback, handler) {
    try {
      const key = `${ _this.pool }:payments:${ blockType }:records`;
      // Get all items using non‑blocking ZSCAN
      const items = await scanZSetAsync(key);
      // Sort by score (timestamp)
      items.sort((a, b) => parseFloat(a.score) - parseFloat(b.score));

      if (items.length > 100) {
        const toRemove = items.slice(0, items.length - 100);
        const commands = [];
        batchDelete(commands, key, toRemove, null); // null => use item.member
        if (commands.length > 0) {
          _this.executeCommands(commands, () => {
            if (_this.poolConfig.debug) {
              logger.debug('Statistics', _this.pool, `Finished updating payments statistics for ${ blockType } configuration.`);
            }
            callback([]);
          }, handler);
        } else {
          callback([]);
        }
      } else {
        callback([]);
      }
    } catch (err) {
      logger.error(logSystem, logComponent, logSubCat, `Error in handlePaymentsInfo: ${ err.message }`);
      handler(err);
    }
  };

  // Execute Redis Commands (unchanged)
  /* istanbul ignore next */
  this.executeCommands = function(commands, callback, handler) {
    _this.client.multi(commands).exec((error, results) => {
      if (error) {
        logger.error(logSystem, logComponent, logSubCat, `Error with redis statistics processing ${ JSON.stringify(error) }`);
        handler(error);
      } else {
        callback(results);
      }
    });
  };

  // Start Interval Initialization (unchanged)
  /* istanbul ignore next */
  this.handleIntervals = function(daemon, blockType) {

    // Handle Blocks Info Interval
    setInterval(() => {
      _this.handleBlocksInfo(blockType, (results) => {
        // results may be empty; we already executed deletions inside
      }, () => {});
    }, _this.blocksInterval * 1000);

    // Handle Hashrate Data Interval
    setInterval(() => {
      _this.handleHashrateInfo(blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating hashrate statistics for ${ blockType } configuration.`);
          }
        }, () => {});
      });
    }, _this.hashrateInterval * 1000);

    // Handle Historical Data Interval
    setInterval(() => {
      _this.handleHistoricalInfo(blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating historical statistics for ${ blockType } configuration.`);
          }
        }, () => {});
      }, () => {});
    }, _this.historicalInterval * 1000);

    // Handle Mining Info Interval
    setInterval(() => {
      _this.handleMiningInfo(daemon, blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating network statistics for ${ blockType } configuration.`);
          }
        }, () => {});
      }, () => {});
    }, _this.refreshInterval * 1000);

    // Handle Payment Info Interval
    setInterval(() => {
      _this.handlePaymentsInfo(blockType, (results) => {
        // deletions already handled inside
      }, () => {});
    }, _this.paymentsInterval * 1000);
  };

  // Start Interval Initialization
  /* istanbul ignore next */
  this.setupStatistics = function(poolStratum) {
    if (poolStratum.primary.daemon) {
      _this.handleIntervals(poolStratum.primary.daemon, 'primary');
      if (_this.poolConfig.auxiliary && _this.poolConfig.auxiliary.enabled && poolStratum.auxiliary.daemon) {
        _this.handleIntervals(poolStratum.auxiliary.daemon, 'auxiliary');
      }
    }
  };
};

module.exports = PoolStatistics;
