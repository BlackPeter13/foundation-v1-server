/*
 *
 * API (Updated) – Non‑blocking SCAN streams
 *
 */

const utils = require('./utils');
const Algorithms = require('foundation-stratum').algorithms;

////////////////////////////////////////////////////////////////////////////////

// Main API Function
const PoolApi = function (client, poolConfigs, portalConfig) {

  const _this = this;
  this.client = client;
  this.poolConfigs = poolConfigs;
  this.portalConfig = portalConfig;
  this.headers = {
    'Access-Control-Allow-Headers' : 'Content-Type, Access-Control-Allow-Headers, Access-Control-Allow-Origin, Access-Control-Allow-Methods',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Content-Type': 'application/json'
  };

  // ==================== NON‑BLOCKING SCAN HELPERS ====================

  // Scan a set -> returns array of members
  function scanSet(key, pattern = '*', count = 100) {
    return new Promise((resolve, reject) => {
      const stream = _this.client.sscanStream(key, { match: pattern, count });
      const members = [];
      stream.on('data', (chunk) => { members.push(...chunk); });
      stream.on('end', () => resolve(members));
      stream.on('error', reject);
    });
  }

  // Scan a hash -> returns object { field: value, ... }
  function scanHash(key, count = 100) {
    return new Promise((resolve, reject) => {
      const stream = _this.client.hscanStream(key, { count });
      const obj = {};
      stream.on('data', (chunk) => {
        for (let i = 0; i < chunk.length; i += 2) {
          obj[chunk[i]] = chunk[i + 1];
        }
      });
      stream.on('end', () => resolve(obj));
      stream.on('error', reject);
    });
  }

  // Scan a sorted set -> returns array of { member, score }
  function scanZSet(key, count = 100) {
    return new Promise((resolve, reject) => {
      const stream = _this.client.zscanStream(key, { count });
      const items = [];
      stream.on('data', (chunk) => {
        for (let i = 0; i < chunk.length; i += 2) {
          items.push({ member: chunk[i], score: parseFloat(chunk[i+1]) });
        }
      });
      stream.on('end', () => resolve(items));
      stream.on('error', reject);
    });
  }

  // Scan keys matching a pattern (non‑blocking)
  function scanKeys(pattern, count = 100) {
    return new Promise((resolve, reject) => {
      const stream = _this.client.scanStream({ match: pattern, count });
      const keys = [];
      stream.on('data', (chunk) => { keys.push(...chunk); });
      stream.on('end', () => resolve(keys));
      stream.on('error', reject);
    });
  }

  // ==================== ORIGINAL HANDLERS (modified to use scans) ====================

  // API Endpoint for /blocks/confirmed
  this.handleBlocksConfirmed = async function(pool, callback) {
    try {
      const [primary, auxiliary] = await Promise.all([
        scanSet(`${ pool }:blocks:primary:confirmed`),
        scanSet(`${ pool }:blocks:auxiliary:confirmed`)
      ]);
      callback(200, {
        primary: utils.processBlocks(primary),
        auxiliary: utils.processBlocks(auxiliary),
      });
    } catch (err) {
      callback(500, 'Error reading blocks');
    }
  };

  // API Endpoint for /blocks/kicked
  this.handleBlocksKicked = async function(pool, callback) {
    try {
      const [primary, auxiliary] = await Promise.all([
        scanSet(`${ pool }:blocks:primary:kicked`),
        scanSet(`${ pool }:blocks:auxiliary:kicked`)
      ]);
      callback(200, {
        primary: utils.processBlocks(primary),
        auxiliary: utils.processBlocks(auxiliary)
      });
    } catch (err) {
      callback(500, 'Error reading blocks');
    }
  };

  // API Endpoint for /blocks/pending
  this.handleBlocksPending = async function(pool, callback) {
    try {
      const [primary, auxiliary] = await Promise.all([
        scanSet(`${ pool }:blocks:primary:pending`),
        scanSet(`${ pool }:blocks:auxiliary:pending`)
      ]);
      callback(200, {
        primary: utils.processBlocks(primary),
        auxiliary: utils.processBlocks(auxiliary)
      });
    } catch (err) {
      callback(500, 'Error reading blocks');
    }
  };

  // API Endpoint for /blocks
  this.handleBlocks = async function(pool, callback) {
    try {
      const [primaryConfirmed, primaryKicked, primaryPending,
             auxiliaryConfirmed, auxiliaryKicked, auxiliaryPending] = await Promise.all([
        scanSet(`${ pool }:blocks:primary:confirmed`),
        scanSet(`${ pool }:blocks:primary:kicked`),
        scanSet(`${ pool }:blocks:primary:pending`),
        scanSet(`${ pool }:blocks:auxiliary:confirmed`),
        scanSet(`${ pool }:blocks:auxiliary:kicked`),
        scanSet(`${ pool }:blocks:auxiliary:pending`)
      ]);
      callback(200, {
        primary: {
          confirmed: utils.processBlocks(primaryConfirmed),
          kicked: utils.processBlocks(primaryKicked),
          pending: utils.processBlocks(primaryPending),
        },
        auxiliary: {
          confirmed: utils.processBlocks(auxiliaryConfirmed),
          kicked: utils.processBlocks(auxiliaryKicked),
          pending: utils.processBlocks(auxiliaryPending)
        }
      });
    } catch (err) {
      callback(500, 'Error reading blocks');
    }
  };

  // API Endpoint for /blocks/[miner]
  this.handleBlocksSpecific = async function(pool, miner, callback) {
    try {
      const [primaryConfirmed, primaryKicked, primaryPending,
             auxiliaryConfirmed, auxiliaryKicked, auxiliaryPending] = await Promise.all([
        scanSet(`${ pool }:blocks:primary:confirmed`),
        scanSet(`${ pool }:blocks:primary:kicked`),
        scanSet(`${ pool }:blocks:primary:pending`),
        scanSet(`${ pool }:blocks:auxiliary:confirmed`),
        scanSet(`${ pool }:blocks:auxiliary:kicked`),
        scanSet(`${ pool }:blocks:auxiliary:pending`)
      ]);
      callback(200, {
        primary: {
          confirmed: utils.listBlocks(primaryConfirmed, miner),
          kicked: utils.listBlocks(primaryKicked, miner),
          pending: utils.listBlocks(primaryPending, miner),
        },
        auxiliary: {
          confirmed: utils.listBlocks(auxiliaryConfirmed, miner),
          kicked: utils.listBlocks(auxiliaryKicked, miner),
          pending: utils.listBlocks(auxiliaryPending, miner),
        }
      });
    } catch (err) {
      callback(500, 'Error reading blocks');
    }
  };

  // API Endpoint for /historical
  this.handleHistorical = async function(pool, callback) {
    const historicalWindow = _this.poolConfigs[pool].statistics.historicalWindow;
    const windowHistorical = (((Date.now() / 1000) - historicalWindow) | 0).toString();
    // zrangebyscore with limit would be fine, but we keep it as is (it's already O(log N) and limited by score)
    // We'll use the existing executeCommands for these two since they're not scanning full sets
    const commands = [
      ['zrangebyscore', `${ pool }:statistics:primary:historical`, windowHistorical, '+inf'],
      ['zrangebyscore', `${ pool }:statistics:auxiliary:historical`, windowHistorical, '+inf']
    ];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: utils.processHistorical(results[0]),
        auxiliary: utils.processHistorical(results[1]),
      });
    }, (err) => callback(500, 'Error reading historical'));
  };

  // API Endpoint for /miners/active
  this.handleMinersActive = async function(pool, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    try {
      const [primarySharedShares, primarySharedHash, primarySoloShares, primarySoloHash,
             auxiliarySharedShares, auxiliarySharedHash, auxiliarySoloShares, auxiliarySoloHash] = await Promise.all([
        scanHash(`${ pool }:rounds:primary:current:shared:shares`),
        // zrangebyscore is fine, we keep as multi
        new Promise((resolve, reject) => {
          _this.client.zrangebyscore(`${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf', (err, res) => {
            if (err) reject(err); else resolve(res);
          });
        }),
        scanHash(`${ pool }:rounds:primary:current:solo:shares`),
        new Promise((resolve, reject) => {
          _this.client.zrangebyscore(`${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf', (err, res) => {
            if (err) reject(err); else resolve(res);
          });
        }),
        scanHash(`${ pool }:rounds:auxiliary:current:shared:shares`),
        new Promise((resolve, reject) => {
          _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf', (err, res) => {
            if (err) reject(err); else resolve(res);
          });
        }),
        scanHash(`${ pool }:rounds:auxiliary:current:solo:shares`),
        new Promise((resolve, reject) => {
          _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf', (err, res) => {
            if (err) reject(err); else resolve(res);
          });
        })
      ]);
      callback(200, {
        primary: {
          shared: utils.processMiners(primarySharedShares, primarySharedHash, multiplier, hashrateWindow, true),
          solo: utils.processMiners(primarySoloShares, primarySoloHash, multiplier, hashrateWindow, true),
        },
        auxiliary: {
          shared: utils.processMiners(auxiliarySharedShares, auxiliarySharedHash, multiplier, hashrateWindow, true),
          solo: utils.processMiners(auxiliarySoloShares, auxiliarySoloHash, multiplier, hashrateWindow, true),
        }
      });
    } catch (err) {
      callback(500, 'Error reading miners');
    }
  };

  // API Endpoint for /miners/[miner]
  this.handleMinersSpecific = async function(pool, miner, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    try {
      const [primaryBal, primaryGen, primaryImm, primaryPaid,
             primarySharedShares, primarySharedHash, primarySoloShares, primarySoloHash,
             auxiliaryBal, auxiliaryGen, auxiliaryImm, auxiliaryPaid,
             auxiliarySharedShares, auxiliarySharedHash, auxiliarySoloShares, auxiliarySoloHash] = await Promise.all([
        scanHash(`${ pool }:payments:primary:balances`),
        scanHash(`${ pool }:payments:primary:generate`),
        scanHash(`${ pool }:payments:primary:immature`),
        scanHash(`${ pool }:payments:primary:paid`),
        scanHash(`${ pool }:rounds:primary:current:shared:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:primary:current:solo:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:payments:auxiliary:balances`),
        scanHash(`${ pool }:payments:auxiliary:generate`),
        scanHash(`${ pool }:payments:auxiliary:immature`),
        scanHash(`${ pool }:payments:auxiliary:paid`),
        scanHash(`${ pool }:rounds:auxiliary:current:shared:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:auxiliary:current:solo:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r)))
      ]);

      // Structure data (same as original)
      const primarySharedShareData = utils.processShares(primarySharedShares, miner, 'miner');
      const primarySoloShareData = utils.processShares(primarySoloShares, miner, 'miner');
      const auxiliarySharedShareData = utils.processShares(auxiliarySharedShares, miner, 'miner');
      const auxiliarySoloShareData = utils.processShares(auxiliarySoloShares, miner, 'miner');

      const primarySharedTimesData = utils.processTimes(primarySharedShares, miner, 'miner');
      const auxiliarySharedTimesData = utils.processTimes(auxiliarySharedShares, miner, 'miner');

      const primarySharedHashrateData = utils.processWork(primarySharedHash, miner, 'miner');
      const primarySoloHashrateData = utils.processWork(primarySoloHash, miner, 'miner');
      const auxiliarySharedHashrateData = utils.processWork(auxiliarySharedHash, miner, 'miner');
      const auxiliarySoloHashrateData = utils.processWork(auxiliarySoloHash, miner, 'miner');

      const primaryBalanceData = utils.processPayments(primaryBal, miner)[miner];
      const primaryGenerateData = utils.processPayments(primaryGen, miner)[miner];
      const primaryImmatureData = utils.processPayments(primaryImm, miner)[miner];
      const primaryPaidData = utils.processPayments(primaryPaid, miner)[miner];
      const auxiliaryBalanceData = utils.processPayments(auxiliaryBal, miner)[miner];
      const auxiliaryGenerateData = utils.processPayments(auxiliaryGen, miner)[miner];
      const auxiliaryImmatureData = utils.processPayments(auxiliaryImm, miner)[miner];
      const auxiliaryPaidData = utils.processPayments(auxiliaryPaid, miner)[miner];

      const primarySharedTypesData = utils.processTypes(primarySharedShares, miner, 'miner');
      const primarySoloTypesData = utils.processTypes(primarySoloShares, miner, 'miner');
      const auxiliarySharedTypesData = utils.processTypes(auxiliarySharedShares, miner, 'miner');
      const auxiliarySoloTypesData = utils.processTypes(auxiliarySoloShares, miner, 'miner');

      const primarySharedWorkerData = utils.listWorkers(primarySharedShares, miner);
      const primarySoloWorkerData = utils.listWorkers(primarySoloShares, miner);
      const auxiliarySharedWorkerData = utils.listWorkers(auxiliarySharedShares, miner);
      const auxiliarySoloWorkerData = utils.listWorkers(auxiliarySoloShares, miner);

      callback(200, {
        primary: {
          hashrate: {
            shared: (multiplier * primarySharedHashrateData) / hashrateWindow,
            solo: (multiplier * primarySoloHashrateData) / hashrateWindow,
          },
          payments: {
            balances: primaryBalanceData || 0,
            generate: primaryGenerateData || 0,
            immature: primaryImmatureData || 0,
            paid: primaryPaidData || 0,
          },
          shares: {
            shared: primarySharedTypesData[miner] || {},
            solo: primarySoloTypesData[miner] || {},
          },
          times: {
            shared: primarySharedTimesData[miner] || 0,
          },
          work: {
            shared: primarySharedShareData[miner] || 0,
            solo: primarySoloShareData[miner] || 0,
          },
          workers: {
            shared: primarySharedWorkerData,
            solo: primarySoloWorkerData,
          },
        },
        auxiliary: {
          hashrate: {
            shared: (multiplier * auxiliarySharedHashrateData) / hashrateWindow,
            solo: (multiplier * auxiliarySoloHashrateData) / hashrateWindow,
          },
          payments: {
            balances: auxiliaryBalanceData || 0,
            generate: auxiliaryGenerateData || 0,
            immature: auxiliaryImmatureData || 0,
            paid: auxiliaryPaidData || 0,
          },
          shares: {
            shared: auxiliarySharedTypesData[miner] || {},
            solo: auxiliarySoloTypesData[miner] || {},
          },
          times: {
            shared: auxiliarySharedTimesData[miner] || 0,
          },
          work: {
            shared: auxiliarySharedShareData[miner] || 0,
            solo: auxiliarySoloShareData[miner] || 0,
          },
          workers: {
            shared: auxiliarySharedWorkerData,
            solo: auxiliarySoloWorkerData,
          },
        }
      });
    } catch (err) {
      callback(500, 'Error reading miner data');
    }
  };

  // API Endpoint for /miners
  this.handleMiners = async function(pool, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    try {
      const [primarySharedShares, primarySharedHash, primarySoloShares, primarySoloHash,
             auxiliarySharedShares, auxiliarySharedHash, auxiliarySoloShares, auxiliarySoloHash] = await Promise.all([
        scanHash(`${ pool }:rounds:primary:current:shared:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:primary:current:solo:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:auxiliary:current:shared:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:auxiliary:current:solo:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r)))
      ]);
      callback(200, {
        primary: {
          shared: utils.processMiners(primarySharedShares, primarySharedHash, multiplier, hashrateWindow, false),
          solo: utils.processMiners(primarySoloShares, primarySoloHash, multiplier, hashrateWindow, false),
        },
        auxiliary: {
          shared: utils.processMiners(auxiliarySharedShares, auxiliarySharedHash, multiplier, hashrateWindow, false),
          solo: utils.processMiners(auxiliarySoloShares, auxiliarySoloHash, multiplier, hashrateWindow, false),
        }
      });
    } catch (err) {
      callback(500, 'Error reading miners');
    }
  };

  // API Endpoint for /payments/balances
  this.handlePaymentsBalances = async function(pool, callback) {
    try {
      const [primary, auxiliary] = await Promise.all([
        scanHash(`${ pool }:payments:primary:balances`),
        scanHash(`${ pool }:payments:auxiliary:balances`)
      ]);
      callback(200, {
        primary: utils.processPayments(primary),
        auxiliary: utils.processPayments(auxiliary),
      });
    } catch (err) {
      callback(500, 'Error reading payments');
    }
  };

  // API Endpoint for /payments/generate
  this.handlePaymentsGenerate = async function(pool, callback) {
    try {
      const [primary, auxiliary] = await Promise.all([
        scanHash(`${ pool }:payments:primary:generate`),
        scanHash(`${ pool }:payments:auxiliary:generate`)
      ]);
      callback(200, {
        primary: utils.processPayments(primary),
        auxiliary: utils.processPayments(auxiliary),
      });
    } catch (err) {
      callback(500, 'Error reading payments');
    }
  };

  // API Endpoint for /payments/immature
  this.handlePaymentsImmature = async function(pool, callback) {
    try {
      const [primary, auxiliary] = await Promise.all([
        scanHash(`${ pool }:payments:primary:immature`),
        scanHash(`${ pool }:payments:auxiliary:immature`)
      ]);
      callback(200, {
        primary: utils.processPayments(primary),
        auxiliary: utils.processPayments(auxiliary),
      });
    } catch (err) {
      callback(500, 'Error reading payments');
    }
  };

  // API Endpoint for /payments/paid
  this.handlePaymentsPaid = async function(pool, callback) {
    try {
      const [primary, auxiliary] = await Promise.all([
        scanHash(`${ pool }:payments:primary:paid`),
        scanHash(`${ pool }:payments:auxiliary:paid`)
      ]);
      callback(200, {
        primary: utils.processPayments(primary),
        auxiliary: utils.processPayments(auxiliary),
      });
    } catch (err) {
      callback(500, 'Error reading payments');
    }
  };

  // API Endpoint for /payments/records
  this.handlePaymentsRecords = async function(pool, callback) {
    try {
      const [primaryItems, auxiliaryItems] = await Promise.all([
        scanZSet(`${ pool }:payments:primary:records`),
        scanZSet(`${ pool }:payments:auxiliary:records`)
      ]);
      const primary = primaryItems.map(item => item.member);
      const auxiliary = auxiliaryItems.map(item => item.member);
      callback(200, {
        primary: utils.processRecords(primary),
        auxiliary: utils.processRecords(auxiliary),
      });
    } catch (err) {
      callback(500, 'Error reading payment records');
    }
  };

  // API Endpoint for /payments
  this.handlePayments = async function(pool, callback) {
    try {
      const [primaryBal, primaryGen, primaryImm, primaryPaid,
             auxiliaryBal, auxiliaryGen, auxiliaryImm, auxiliaryPaid] = await Promise.all([
        scanHash(`${ pool }:payments:primary:balances`),
        scanHash(`${ pool }:payments:primary:generate`),
        scanHash(`${ pool }:payments:primary:immature`),
        scanHash(`${ pool }:payments:primary:paid`),
        scanHash(`${ pool }:payments:auxiliary:balances`),
        scanHash(`${ pool }:payments:auxiliary:generate`),
        scanHash(`${ pool }:payments:auxiliary:immature`),
        scanHash(`${ pool }:payments:auxiliary:paid`)
      ]);
      callback(200, {
        primary: {
          balances: utils.processPayments(primaryBal),
          generate: utils.processPayments(primaryGen),
          immature: utils.processPayments(primaryImm),
          paid: utils.processPayments(primaryPaid),
        },
        auxiliary: {
          balances: utils.processPayments(auxiliaryBal),
          generate: utils.processPayments(auxiliaryGen),
          immature: utils.processPayments(auxiliaryImm),
          paid: utils.processPayments(auxiliaryPaid),
        }
      });
    } catch (err) {
      callback(500, 'Error reading payments');
    }
  };

  // API Endpoint for /rounds/current
  this.handleRoundsCurrent = async function(pool, callback) {
    try {
      const [primaryShared, primarySolo, auxiliaryShared, auxiliarySolo] = await Promise.all([
        scanHash(`${ pool }:rounds:primary:current:shared:shares`),
        scanHash(`${ pool }:rounds:primary:current:solo:shares`),
        scanHash(`${ pool }:rounds:auxiliary:current:shared:shares`),
        scanHash(`${ pool }:rounds:auxiliary:current:solo:shares`)
      ]);
      callback(200, {
        primary: {
          round: 'current',
          shared: utils.processShares(primaryShared),
          solo: utils.processShares(primarySolo),
          times: utils.processTimes(primaryShared),
        },
        auxiliary: {
          round: 'current',
          shared: utils.processShares(auxiliaryShared),
          solo: utils.processShares(auxiliarySolo),
          times: utils.processTimes(auxiliaryShared),
        }
      });
    } catch (err) {
      callback(500, 'Error reading rounds');
    }
  };

  // API Endpoint for /rounds/[height]
  this.handleRoundsHeight = async function(pool, height, callback) {
    try {
      const [primary, auxiliary] = await Promise.all([
        scanHash(`${ pool }:rounds:primary:round-${ height }:shares`),
        scanHash(`${ pool }:rounds:auxiliary:round-${ height }:shares`)
      ]);
      callback(200, {
        primary: {
          round: parseFloat(height),
          times: utils.processTimes(primary),
          work: utils.processShares(primary),
        },
        auxiliary: {
          round: parseFloat(height),
          times: utils.processTimes(auxiliary),
          work: utils.processShares(auxiliary),
        }
      });
    } catch (err) {
      callback(500, 'Error reading round data');
    }
  };

  // Helper Function for /rounds (now using scanKeys)
  this.processRounds = async function(pool, blockType) {
    const pattern = `${ pool }:rounds:${ blockType }:round-*:shares`;
    const keys = await scanKeys(pattern);
    const heights = keys.map(key => key.split(':')[3].split('-')[1]);
    const results = [];
    for (const height of heights) {
      const shares = await scanHash(`${ pool }:rounds:${ blockType }:round-${ height }:shares`);
      results.push({
        round: parseFloat(height),
        times: utils.processTimes(shares),
        work: utils.processShares(shares),
      });
    }
    return results;
  };

  // API Endpoint for /rounds
  this.handleRounds = async function(pool, callback) {
    try {
      const [primaryRounds, auxiliaryRounds] = await Promise.all([
        _this.processRounds(pool, 'primary'),
        _this.processRounds(pool, 'auxiliary')
      ]);
      callback(200, {
        primary: primaryRounds,
        auxiliary: auxiliaryRounds
      });
    } catch (err) {
      callback(500, 'Error reading rounds');
    }
  };

  // API Endpoint for /statistics
  this.handleStatistics = async function(pool, callback) {
    const config = _this.poolConfigs[pool] || {};
    const algorithm = config.primary.coin.algorithms.mining;
    const hashrateWindow = config.statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();

    try {
      // Many of these are small hashes, but we'll use scan for consistency
      const [
        primaryBlockCounts, primaryPending, primaryConfirmed,
        primaryPaymentCounts, primarySharedCounts, primarySharedHash, primarySoloHash,
        primaryNetwork,
        auxiliaryBlockCounts, auxiliaryPending, auxiliaryConfirmed,
        auxiliaryPaymentCounts, auxiliarySharedCounts, auxiliarySharedHash, auxiliarySoloHash,
        auxiliaryNetwork
      ] = await Promise.all([
        scanHash(`${ pool }:blocks:primary:counts`),
        scanSet(`${ pool }:blocks:primary:pending`),
        scanSet(`${ pool }:blocks:primary:confirmed`),
        scanHash(`${ pool }:payments:primary:counts`),
        scanHash(`${ pool }:rounds:primary:current:shared:counts`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:statistics:primary:network`),
        scanHash(`${ pool }:blocks:auxiliary:counts`),
        scanSet(`${ pool }:blocks:auxiliary:pending`),
        scanSet(`${ pool }:blocks:auxiliary:confirmed`),
        scanHash(`${ pool }:payments:auxiliary:counts`),
        scanHash(`${ pool }:rounds:auxiliary:current:shared:counts`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:statistics:auxiliary:network`)
      ]);

      callback(200, {
        primary: {
          config: {
            coin: config.enabled ? config.primary.coin.name : '',
            symbol: config.enabled ? config.primary.coin.symbol : '',
            algorithm: config.enabled ? config.primary.coin.algorithms.mining : '',
            paymentInterval: config.enabled ? config.primary.payments.paymentInterval : 0,
            minPayment: config.enabled ? config.primary.payments.minPayment : 0,
            recipientFee: config.enabled ? config.primary.recipients.reduce((p_sum, a) => p_sum + a.percentage, 0) : 0,
          },
          blocks: {
            valid: parseFloat(primaryBlockCounts ? primaryBlockCounts.valid || 0 : 0),
            invalid: parseFloat(primaryBlockCounts ? primaryBlockCounts.invalid || 0 : 0),
          },
          shares: {
            valid: parseFloat(primarySharedCounts ? primarySharedCounts.valid || 0 : 0),
            stale: parseFloat(primarySharedCounts ? primarySharedCounts.stale || 0 : 0),
            invalid: parseFloat(primarySharedCounts ? primarySharedCounts.invalid || 0 : 0),
          },
          hashrate: {
            shared: (multiplier * utils.processWork(primarySharedHash)) / hashrateWindow,
            solo: (multiplier * utils.processWork(primarySoloHash)) / hashrateWindow,
          },
          network: {
            difficulty: parseFloat(primaryNetwork ? primaryNetwork.difficulty || 0 : 0),
            hashrate: parseFloat(primaryNetwork ? primaryNetwork.hashrate || 0 : 0),
            height: parseFloat(primaryNetwork ? primaryNetwork.height || 0 : 0),
          },
          payments: {
            last: parseFloat(primaryPaymentCounts ? primaryPaymentCounts.last || 0 : 0),
            next: parseFloat(primaryPaymentCounts ? primaryPaymentCounts.next || 0 : 0),
            total: parseFloat(primaryPaymentCounts ? primaryPaymentCounts.total || 0 : 0),
          },
          status: {
            effort: parseFloat(primarySharedCounts ? primarySharedCounts.effort || 0 : 0),
            luck: utils.processLuck(primaryPending, primaryConfirmed),
            miners: utils.combineMiners(primarySharedHash, primarySoloHash),
            workers: utils.combineWorkers(primarySharedHash, primarySoloHash),
          },
        },
        auxiliary: {
          config: {
            coin: (config.auxiliary && config.auxiliary.enabled) ? config.auxiliary.coin.name : '',
            symbol: (config.auxiliary && config.auxiliary.enabled) ? config.auxiliary.coin.symbol : '',
            algorithm: (config.auxiliary && config.auxiliary.enabled) ? config.primary.coin.algorithms.mining : '',
            paymentInterval: (config.auxiliary && config.auxiliary.enabled) ? config.auxiliary.payments.paymentInterval : 0,
            minPayment: (config.auxiliary && config.auxiliary.enabled) ? config.auxiliary.payments.minPayment : 0,
            recipientFee: (config.auxiliary && config.auxiliary.enabled) ? config.auxiliary.recipients.reduce((p_sum, a) => p_sum + a.percentage, 0) : 0,
          },
          blocks: {
            valid: parseFloat(auxiliaryBlockCounts ? auxiliaryBlockCounts.valid || 0 : 0),
            invalid: parseFloat(auxiliaryBlockCounts ? auxiliaryBlockCounts.invalid || 0 : 0),
          },
          shares: {
            valid: parseFloat(auxiliarySharedCounts ? auxiliarySharedCounts.valid || 0 : 0),
            stale: parseFloat(auxiliarySharedCounts ? auxiliarySharedCounts.stale || 0 : 0),
            invalid: parseFloat(auxiliarySharedCounts ? auxiliarySharedCounts.invalid || 0 : 0),
          },
          hashrate: {
            shared: (multiplier * utils.processWork(auxiliarySharedHash)) / hashrateWindow,
            solo: (multiplier * utils.processWork(auxiliarySoloHash)) / hashrateWindow,
          },
          network: {
            difficulty: parseFloat(auxiliaryNetwork ? auxiliaryNetwork.difficulty || 0 : 0),
            hashrate: parseFloat(auxiliaryNetwork ? auxiliaryNetwork.hashrate || 0 : 0),
            height: parseFloat(auxiliaryNetwork ? auxiliaryNetwork.height || 0 : 0),
          },
          payments: {
            last: parseFloat(auxiliaryPaymentCounts ? auxiliaryPaymentCounts.last || 0 : 0),
            next: parseFloat(auxiliaryPaymentCounts ? auxiliaryPaymentCounts.next || 0 : 0),
            total: parseFloat(auxiliaryPaymentCounts ? auxiliaryPaymentCounts.total || 0 : 0),
          },
          status: {
            effort: parseFloat(auxiliarySharedCounts ? auxiliarySharedCounts.effort || 0 : 0),
            luck: utils.processLuck(auxiliaryPending, auxiliaryConfirmed),
            miners: utils.combineMiners(auxiliarySharedHash, auxiliarySoloHash),
            workers: utils.combineWorkers(auxiliarySharedHash, auxiliarySoloHash),
          },
        }
      });
    } catch (err) {
      callback(500, 'Error reading statistics');
    }
  };

  // API Endpoint for /workers/active
  this.handleWorkersActive = async function(pool, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    try {
      const [primarySharedShares, primarySharedHash, primarySoloShares, primarySoloHash,
             auxiliarySharedShares, auxiliarySharedHash, auxiliarySoloShares, auxiliarySoloHash] = await Promise.all([
        scanHash(`${ pool }:rounds:primary:current:shared:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:primary:current:solo:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:auxiliary:current:shared:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:auxiliary:current:solo:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r)))
      ]);
      callback(200, {
        primary: {
          shared: utils.processWorkers(primarySharedShares, primarySharedHash, multiplier, hashrateWindow, true),
          solo: utils.processWorkers(primarySoloShares, primarySoloHash, multiplier, hashrateWindow, true),
        },
        auxiliary: {
          shared: utils.processWorkers(auxiliarySharedShares, auxiliarySharedHash, multiplier, hashrateWindow, true),
          solo: utils.processWorkers(auxiliarySoloShares, auxiliarySoloHash, multiplier, hashrateWindow, true),
        }
      });
    } catch (err) {
      callback(500, 'Error reading workers');
    }
  };

  // API Endpoint for /workers/[worker]
  this.handleWorkersSpecific = async function(pool, worker, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    try {
      const [primarySharedShares, primarySharedHash, primarySoloShares, primarySoloHash,
             auxiliarySharedShares, auxiliarySharedHash, auxiliarySoloShares, auxiliarySoloHash] = await Promise.all([
        scanHash(`${ pool }:rounds:primary:current:shared:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:primary:current:solo:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:auxiliary:current:shared:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:auxiliary:current:solo:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r)))
      ]);

      const primarySharedShareData = utils.processShares(primarySharedShares, worker, 'worker');
      const primarySoloShareData = utils.processShares(primarySoloShares, worker, 'worker');
      const auxiliarySharedShareData = utils.processShares(auxiliarySharedShares, worker, 'worker');
      const auxiliarySoloShareData = utils.processShares(auxiliarySoloShares, worker, 'worker');

      const primarySharedTimesData = utils.processTimes(primarySharedShares, worker, 'worker');
      const auxiliarySharedTimesData = utils.processTimes(auxiliarySharedShares, worker, 'worker');

      const primarySharedHashrateData = utils.processWork(primarySharedHash, worker, 'worker');
      const primarySoloHashrateData = utils.processWork(primarySoloHash, worker, 'worker');
      const auxiliarySharedHashrateData = utils.processWork(auxiliarySharedHash, worker, 'worker');
      const auxiliarySoloHashrateData = utils.processWork(auxiliarySoloHash, worker, 'worker');

      const primarySharedTypesData = utils.processTypes(primarySharedShares, worker, 'worker');
      const primarySoloTypesData = utils.processTypes(primarySoloShares, worker, 'worker');
      const auxiliarySharedTypesData = utils.processTypes(auxiliarySharedShares, worker, 'worker');
      const auxiliarySoloTypesData = utils.processTypes(auxiliarySoloShares, worker, 'worker');

      callback(200, {
        primary: {
          hashrate: {
            shared: (multiplier * primarySharedHashrateData) / hashrateWindow,
            solo: (multiplier * primarySoloHashrateData) / hashrateWindow,
          },
          shares: {
            shared: primarySharedTypesData[worker] || {},
            solo: primarySoloTypesData[worker] || {},
          },
          times: {
            shared: primarySharedTimesData[worker] || 0,
          },
          work: {
            shared: primarySharedShareData[worker] || 0,
            solo: primarySoloShareData[worker] || 0,
          },
        },
        auxiliary: {
          hashrate: {
            shared: (multiplier * auxiliarySharedHashrateData) / hashrateWindow,
            solo: (multiplier * auxiliarySoloHashrateData) / hashrateWindow,
          },
          shares: {
            shared: auxiliarySharedTypesData[worker] || {},
            solo: auxiliarySoloTypesData[worker] || {},
          },
          times: {
            shared: auxiliarySharedTimesData[worker] || 0,
          },
          work: {
            shared: auxiliarySharedShareData[worker] || 0,
            solo: auxiliarySoloShareData[worker] || 0,
          },
        }
      });
    } catch (err) {
      callback(500, 'Error reading worker data');
    }
  };

  // API Endpoint for /workers
  this.handleWorkers = async function(pool, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    try {
      const [primarySharedShares, primarySharedHash, primarySoloShares, primarySoloHash,
             auxiliarySharedShares, auxiliarySharedHash, auxiliarySoloShares, auxiliarySoloHash] = await Promise.all([
        scanHash(`${ pool }:rounds:primary:current:shared:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:primary:current:solo:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:auxiliary:current:shared:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r))),
        scanHash(`${ pool }:rounds:auxiliary:current:solo:shares`),
        new Promise((resolve, reject) => _this.client.zrangebyscore(`${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf', (e, r) => e ? reject(e) : resolve(r)))
      ]);
      callback(200, {
        primary: {
          shared: utils.processWorkers(primarySharedShares, primarySharedHash, multiplier, hashrateWindow, false),
          solo: utils.processWorkers(primarySoloShares, primarySoloHash, multiplier, hashrateWindow, false),
        },
        auxiliary: {
          shared: utils.processWorkers(auxiliarySharedShares, auxiliarySharedHash, multiplier, hashrateWindow, false),
          solo: utils.processWorkers(auxiliarySoloShares, auxiliarySoloHash, multiplier, hashrateWindow, false),
        }
      });
    } catch (err) {
      callback(500, 'Error reading workers');
    }
  };

  // ==================== EXECUTE COMMANDS (still used for zrangebyscore) ====================

  /* istanbul ignore next */
  this.executeCommands = function(commands, callback, handler) {
    _this.client.multi(commands).exec((error, results) => {
      if (error) {
        handler(500, 'The server was unable to handle your request. Verify your input or try again later');
      } else {
        callback(results);
      }
    });
  };

  // Build API Payload (unchanged)
  this.buildResponse = function(code, message, response) {
    const payload = {
      version: '0.0.3',
      statusCode: code,
      headers: _this.headers,
      body: message,
    };
    response.writeHead(code, _this.headers);
    response.end(JSON.stringify(payload));
  };

  // Determine API Endpoint Called (unchanged)
  this.handleApiV1 = function(req, callback) {
    let pool, endpoint, method;
    const miscellaneous = ['pools'];

    if (req.params) {
      pool = utils.validateInput(req.params.pool || '');
      endpoint = utils.validateInput(req.params.endpoint || '');
    }

    if (req.query) {
      method = utils.validateInput(req.query.method || '');
    }

    if (!(pool in _this.poolConfigs) && !(miscellaneous.includes(pool))) {
      callback(404, 'The requested pool was not found. Verify your input and try again');
      return;
    }

    switch (true) {
      // Blocks
      case (endpoint === 'blocks' && method === 'confirmed'):
        _this.handleBlocksConfirmed(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'blocks' && method === 'kicked'):
        _this.handleBlocksKicked(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'blocks' && method === 'pending'):
        _this.handleBlocksPending(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'blocks' && method === ''):
        _this.handleBlocks(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'blocks' && method.length >= 1):
        _this.handleBlocksSpecific(pool, method, (code, message) => callback(code, message));
        break;

      // Historical
      case (endpoint === 'historical' && method === ''):
        _this.handleHistorical(pool, (code, message) => callback(code, message));
        break;

      // Miners
      case (endpoint === 'miners' && method === 'active'):
        _this.handleMinersActive(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'miners' && method.length >= 1):
        _this.handleMinersSpecific(pool, method, (code, message) => callback(code, message));
        break;
      case (endpoint === 'miners' && method === ''):
        _this.handleMiners(pool, (code, message) => callback(code, message));
        break;

      // Payments
      case (endpoint === 'payments' && method === 'balances'):
        _this.handlePaymentsBalances(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'payments' && method === 'generate'):
        _this.handlePaymentsGenerate(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'payments' && method === 'immature'):
        _this.handlePaymentsImmature(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'payments' && method === 'paid'):
        _this.handlePaymentsPaid(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'payments' && method === 'records'):
        _this.handlePaymentsRecords(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'payments' && method === ''):
        _this.handlePayments(pool, (code, message) => callback(code, message));
        break;

      // Ports
      case (endpoint === 'ports' && method === ''):
        callback(200, { ports: _this.poolConfigs[pool].ports });
        break;

      // Rounds
      case (endpoint === 'rounds' && method === 'current'):
        _this.handleRoundsCurrent(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'rounds' && utils.checkNumber(method)):
        _this.handleRoundsHeight(pool, method, (code, message) => callback(code, message));
        break;
      case (endpoint === 'rounds' && method === ''):
        _this.handleRounds(pool, (code, message) => callback(code, message));
        break;

      // Statistics
      case (endpoint === 'statistics' && method === ''):
        _this.handleStatistics(pool, (code, message) => callback(code, message));
        break;

      // Workers
      case (endpoint === 'workers' && method === 'active'):
        _this.handleWorkersActive(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'workers' && method.length >= 1):
        _this.handleWorkersSpecific(pool, method, (code, message) => callback(code, message));
        break;
      case (endpoint === 'workers' && method === ''):
        _this.handleWorkers(pool, (code, message) => callback(code, message));
        break;

      // Miscellaneous
      case (endpoint === '' && method === '' && pool === 'pools'):
        callback(200, Object.keys(_this.poolConfigs));
        break;
      case (endpoint === '' && method === '' && !(miscellaneous.includes(pool))):
        _this.handleStatistics(pool, (code, message) => callback(code, message));
        break;

      default:
        callback(405, 'The requested method is not currently supported. Verify your input and try again');
        break;
    }
  };
};

module.exports = PoolApi;
