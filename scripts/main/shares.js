/*
 *
 * Shares (Updated) – Non‑blocking HSCAN + batched writes (MAX_BATCH_SIZE = 300)
 *
 */

const utils = require('./utils');

////////////////////////////////////////////////////////////////////////////////

// Main Shares Function
const PoolShares = function (logger, client, poolConfig, portalConfig) {

  const _this = this;
  process.setMaxListeners(0);

  this.pool = poolConfig.name;
  this.client = client;
  this.poolConfig = poolConfig;
  this.portalConfig = portalConfig;
  this.forkId = process.env.forkId;

  // Handle Round Values
  this.curHeight = 0;
  this.minHeight = 0;

  const logSystem = 'Pool';
  const logComponent = poolConfig.name;
  const logSubCat = `Thread ${ parseInt(_this.forkId) + 1 }`;

  // Handle Client Messages
  _this.client.on('ready', () => {});
  _this.client.on('error', (error) => {
    logger.error(logSystem, logComponent, logSubCat, `Redis client had an error: ${ JSON.stringify(error) }`);
  });
  _this.client.on('end', () => {
    logger.error(logSystem, logComponent, logSubCat, 'Connection to redis database has been ended');
  });

  // ==================== NON‑BLOCKING HASH READER ====================
  function scanHashToObject(key) {
    return new Promise((resolve, reject) => {
      const obj = {};
      const stream = _this.client.hscanStream(key, { count: 100 });
      stream.on('data', (chunk) => {
        // chunk is [field1, value1, field2, value2, ...]
        for (let i = 0; i < chunk.length; i += 2) {
          obj[chunk[i]] = chunk[i + 1];
        }
      });
      stream.on('end', () => resolve(obj));
      stream.on('error', (err) => {
        logger.error(logSystem, logComponent, logSubCat, `HSCAN error on ${key}: ${err.message}`);
        reject(err);
      });
    });
  }

  // ==================== BATCHED WRITE EXECUTOR ====================
  const MAX_BATCH_SIZE = 300; // Tuned for high share rates – lower batch size reduces Redis lock time

  this.executeCommands = function(commands, callback, handler) {
    if (!commands || commands.length === 0) {
      return callback([]);
    }

    // Split into batches
    const batches = [];
    for (let i = 0; i < commands.length; i += MAX_BATCH_SIZE) {
      batches.push(commands.slice(i, i + MAX_BATCH_SIZE));
    }

    let completed = 0;
    let lastError = null;
    const totalBatches = batches.length;

    if (totalBatches === 1) {
      // Single batch – execute directly
      _this.client.multi(commands).exec((error, results) => {
        if (error) {
          logger.error(logSystem, logComponent, logSubCat, `Redis multi error: ${error.message}`);
          handler(error);
        } else {
          callback(results);
        }
      });
      return;
    }

    // Multiple batches – execute sequentially to avoid overloading Redis
    function executeBatch(index) {
      const batch = batches[index];
      _this.client.multi(batch).exec((error, results) => {
        if (error) {
          logger.error(logSystem, logComponent, logSubCat, `Batch ${index+1}/${totalBatches} failed: ${error.message}`);
          lastError = error;
        }
        completed++;
        if (completed === totalBatches) {
          if (lastError) {
            handler(lastError);
          } else {
            callback([]); // aggregated results not needed for writes
          }
        } else {
          executeBatch(index + 1);
        }
      });
    }

    executeBatch(0);
  };

  // ==================== ORIGINAL LOGIC (unchanged) ====================

  this.handleTimes = function(lastShare, shareType) {
    const dateNow = Date.now();
    const lastTime = lastShare.time || dateNow;
    let times = lastShare.times || 0;
    const timeChange = utils.roundTo(Math.max(dateNow - lastTime, 0) / 1000, 4);
    if ((timeChange < 900) && (shareType === "valid")) {
      times = times + timeChange;
    }
    return times;
  };

  this.handleEffort = function(shares, worker, shareData, shareType, blockDifficulty, isSoloMining) {
    let difficulties = 0;
    Object.keys(shares).forEach((share) => {
      const shareInfo = JSON.parse(shares[share]);
      const workValue = /^-?\d*(\.\d+)?$/.test(shareInfo.work) ? parseFloat(shareInfo.work) : 0;
      if (isSoloMining && share === worker && shareInfo.solo) {
        difficulties += workValue;
      } else if (!isSoloMining && !shareInfo.solo) {
        difficulties += workValue;
      }
    });
    const effort = shareType === "valid" ? (difficulties + shareData.difficulty) : difficulties;
    return effort / blockDifficulty * 100;
  };

  this.handleTypes = function(lastShare, shareType) {
    const types = { valid: 0, invalid: 0, stale: 0 };
    const lastTypes = lastShare.types || types;
    lastTypes[shareType] += 1;
    return lastTypes;
  };

  this.calculateShares = function(results, shareData, shareType, blockType, isSoloMining) {
    let shares;
    const commands = [];
    const dateNow = Date.now();
    const difficulty = (shareType === 'valid' ? shareData.difficulty : -shareData.difficulty);
    const minerType = isSoloMining ? 'solo' : 'shared';
    const identifier = shareData.identifier || '';

    const worker = ['share', 'primary'].includes(blockType) ? shareData.addrPrimary : shareData.addrAuxiliary;
    const blockDifficulty = ['share', 'primary'].includes(blockType) ? shareData.blockDiffPrimary : shareData.blockDiffAuxiliary;

    if (isSoloMining) {
      shares = (['share', 'primary'].includes(blockType)) ? (results[2] || {}) : (results[3] || {});
    } else {
      shares = (['share', 'primary'].includes(blockType)) ? (results[0] || {}) : (results[1] || {});
    }

    const lastShare = JSON.parse(shares[worker] || '{}');

    if (shareData.height > _this.curHeight) _this.curHeight = shareData.height;
    if (!isSoloMining && shareData.height < _this.curHeight) shareType = "stale";

    const times = _this.handleTimes(lastShare, shareType);
    const effort = _this.handleEffort(shares, worker, shareData, shareType, blockDifficulty, isSoloMining);
    const types = _this.handleTypes(lastShare, shareType);
    const work = shareType === "valid" ? difficulty + (lastShare.work || 0) : (lastShare.work || 0);

    const outputShare = {
      time: dateNow,
      effort: effort,
      identifier: identifier,
      round: shareData.height,
      solo: isSoloMining,
      times: times,
      types: types,
      work: work,
      worker: worker,
    };

    if (lastShare.round === 'orphan') {
      lastShare.round = shareData.height;
    }

    if (!isSoloMining && shareData.height < _this.minHeight) {
      logger.warning(logSystem, logComponent, logSubCat, `Resetting share data for ${ worker } due to rounds overlapping.`);
      outputShare.effort = shareData.difficulty / blockDifficulty * 100;
      outputShare.times = 0;
      outputShare.types = { valid: 0, invalid: 0, stale: 0 };
      outputShare.work = difficulty;
    }

    const hashrateShare = JSON.parse(JSON.stringify(outputShare));
    hashrateShare.work = difficulty;

    if (shareType === 'valid' && isSoloMining) {
      commands.push(['zadd', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:hashrate`, dateNow / 1000 | 0, JSON.stringify(hashrateShare)]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:shares`, worker, JSON.stringify(outputShare)]);
    } else if (shareType === 'valid') {
      commands.push(['zadd', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:hashrate`, dateNow / 1000 | 0, JSON.stringify(hashrateShare)]);
      commands.push(['hincrby', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:counts`, 'valid', 1]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:shares`, worker, JSON.stringify(outputShare)]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:counts`, 'effort', effort]);
    } else if (shareType === 'stale') {
      commands.push(['zadd', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:hashrate`, dateNow / 1000 | 0, JSON.stringify(hashrateShare)]);
      commands.push(['hincrby', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:counts`, 'stale', 1]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:shares`, worker, JSON.stringify(outputShare)]);
    } else {
      commands.push(['zadd', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:hashrate`, dateNow / 1000 | 0, JSON.stringify(hashrateShare)]);
      commands.push(['hincrby', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:counts`, 'invalid', 1]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:shares`, worker, JSON.stringify(outputShare)]);
    }

    return commands;
  };

  this.calculateBlocks = function(results, shareData, shareType, blockValid, isSoloMining) {
    let shares;
    const commands = [];
    const dateNow = Date.now();
    const blockType = shareData.blockType;
    const difficulty = (shareType === 'valid' ? shareData.difficulty : -shareData.difficulty);
    const minerType = isSoloMining ? 'solo' : 'shared';
    const identifier = shareData.identifier || '';

    const worker = ['share', 'primary'].includes(blockType) ? shareData.addrPrimary : shareData.addrAuxiliary;
    const blockDifficulty = ['share', 'primary'].includes(blockType) ? shareData.blockDiffPrimary : shareData.blockDiffAuxiliary;

    if (isSoloMining) {
      shares = (['share', 'primary'].includes(blockType)) ? (results[2] || {}) : (results[3] || {});
    } else {
      shares = (['share', 'primary'].includes(blockType)) ? (results[0] || {}) : (results[1] || {});
    }

    const lastShare = JSON.parse(shares[worker] || '{}');
    const luck = _this.handleEffort(shares, worker, shareData, shareType, blockDifficulty, isSoloMining);

    const outputBlock = {
      time: dateNow,
      height: shareData.height,
      hash: shareData.hash,
      reward: shareData.reward,
      identifier: identifier,
      transaction: shareData.transaction,
      difficulty: blockDifficulty,
      luck: luck,
      worker: worker,
      solo: isSoloMining,
      round: shareData.height,
    };

    const outputShare = {
      time: dateNow,
      effort: 0,
      identifier: identifier,
      round: shareData.height,
      solo: isSoloMining,
      times: 0,
      types: { valid: 0, invalid: 0, stale: 0 },
      work: difficulty,
      worker: worker,
    };

    const roundShare = JSON.parse(JSON.stringify(outputShare));
    roundShare.effort = luck;
    roundShare.times = lastShare.times;
    roundShare.types = lastShare.types;
    roundShare.work = difficulty + (lastShare.work || 0);

    const workers = Object.keys(results[2] || {}).filter((result) => {
      const address = worker ? worker.split('.')[0] : '';
      return result.split('.')[0] === address;
    });

    if (!isSoloMining && blockValid && shareData.height > _this.minHeight) {
      _this.minHeight = shareData.height;
    }

    if (blockValid && isSoloMining) {
      commands.push(['sadd', `${ _this.pool }:blocks:${ blockType }:pending`, JSON.stringify(outputBlock)]);
      commands.push(['hincrby', `${ _this.pool }:blocks:${ blockType }:counts`, 'valid', 1]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:round-${ shareData.height }:shares`, worker, JSON.stringify(roundShare)]);
      workers.forEach((result) => {
        outputShare.worker = result;
        commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:shares`, result, JSON.stringify(outputShare)]);
      });
    } else if (blockValid) {
      commands.push(['sadd', `${ _this.pool }:blocks:${ blockType }:pending`, JSON.stringify(outputBlock)]);
      commands.push(['hincrby', `${ _this.pool }:blocks:${ blockType }:counts`, 'valid', 1]);
      commands.push(['rename', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:counts`, `${ _this.pool }:rounds:${ blockType }:round-${ shareData.height }:counts`]);
      commands.push(['rename', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:shares`, `${ _this.pool }:rounds:${ blockType }:round-${ shareData.height }:shares`]);
      process.send({ pool: _this.pool, type: 'roundUpdate' });
    } else if (shareData.transaction) {
      commands.push(['hincrby', `${ _this.pool }:blocks:${ blockType }:counts`, 'invalid', 1]);
    }

    return commands;
  };

  this.buildSharesCommands = function(results, shareData, shareType, blockValid, isSoloMining) {
    let commands = [];
    commands = commands.concat(_this.calculateShares(results, shareData, shareType, 'primary', isSoloMining));
    if (_this.poolConfig.auxiliary && _this.poolConfig.auxiliary.enabled) {
      commands = commands.concat(_this.calculateShares(results, shareData, shareType, 'auxiliary', isSoloMining));
    }
    return commands;
  };

  this.buildCommands = function(results, shareData, shareType, blockValid, callback, handler) {
    let commands = [];
    const isSoloMining = utils.checkSoloMining(_this.poolConfig, shareData);
    commands = commands.concat(_this.buildSharesCommands(results, shareData, shareType, blockValid, isSoloMining));
    commands = commands.concat(_this.calculateBlocks(results, shareData, shareType, blockValid, isSoloMining));
    _this.executeCommands(commands, callback, handler);
    return commands;
  };

  // ==================== NON‑BLOCKING HANDLE SHARES ====================

  this.handleShares = function(shareData, shareType, blockValid, callback, handler) {
    // Use HSCAN to read each hash without blocking
    const keys = [
      `${ _this.pool }:rounds:primary:current:shared:shares`,
      `${ _this.pool }:rounds:auxiliary:current:shared:shares`,
      `${ _this.pool }:rounds:primary:current:solo:shares`,
      `${ _this.pool }:rounds:auxiliary:current:solo:shares`
    ];

    Promise.all(keys.map(key => scanHashToObject(key)))
      .then((results) => {
        // results[0] = shared primary, [1] = shared auxiliary, [2] = solo primary, [3] = solo auxiliary
        _this.buildCommands(results, shareData, shareType, blockValid, callback, handler);
      })
      .catch((err) => {
        logger.error(logSystem, logComponent, logSubCat, `Failed to read share hashes: ${err.message}`);
        handler(err);
      });
  };
};

module.exports = PoolShares;
