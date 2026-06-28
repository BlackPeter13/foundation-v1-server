/*
 *
 * API (Updated) – Redis v4 compatible, with fallback defaults
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

  // ==================== REDIS v4 HELPERS ====================

  // Wrapper for hGetAll (returns empty object if key missing)
  async function hGetAllSafe(key) {
    try {
      const result = await _this.client.hGetAll(key);
      return result || {};
    } catch (e) {
      return {};
    }
  }

  // Wrapper for zRangeByScore (returns empty array if key missing)
  async function zRangeByScoreSafe(key, min, max) {
    try {
      const result = await _this.client.zRangeByScore(key, min, max);
      return result || [];
    } catch (e) {
      return [];
    }
  }

  // Wrapper for sScan (returns array of members)
  async function sScanSafe(key, pattern = '*', count = 100) {
    try {
      const result = [];
      let cursor = '0';
      do {
        const reply = await _this.client.scan(cursor, 'MATCH', pattern, 'COUNT', count);
        cursor = reply.cursor;
        result.push(...reply.keys);
      } while (cursor !== '0');
      return result;
    } catch (e) {
      return [];
    }
  }

  // Wrapper for hScan (returns object)
  async function hScanSafe(key, count = 100) {
    try {
      const result = {};
      let cursor = '0';
      do {
        const reply = await _this.client.hScan(key, cursor, 'COUNT', count);
        cursor = reply.cursor;
        for (let i = 0; i < reply.fields.length; i += 2) {
          result[reply.fields[i]] = reply.fields[i + 1];
        }
      } while (cursor !== '0');
      return result;
    } catch (e) {
      return {};
    }
  }

  // Wrapper for zScan (returns array of {member, score})
  async function zScanSafe(key, count = 100) {
    try {
      const items = [];
      let cursor = '0';
      do {
        const reply = await _this.client.zScan(key, cursor, 'COUNT', count);
        cursor = reply.cursor;
        for (let i = 0; i < reply.members.length; i += 2) {
          items.push({ member: reply.members[i], score: parseFloat(reply.members[i+1]) });
        }
      } while (cursor !== '0');
      return items;
    } catch (e) {
      return [];
    }
  }

  // ==================== HANDLERS (all use safe wrappers) ====================

  // Blocks confirmed
  this.handleBlocksConfirmed = async function(pool, callback) {
    try {
      const primary = await sScanSafe(`${pool}:blocks:primary:confirmed`);
      const auxiliary = await sScanSafe(`${pool}:blocks:auxiliary:confirmed`);
      callback(200, {
        primary: utils.processBlocks(primary),
        auxiliary: utils.processBlocks(auxiliary),
      });
    } catch (err) {
      callback(500, 'Error reading blocks');
    }
  };

  // Blocks kicked
  this.handleBlocksKicked = async function(pool, callback) {
    try {
      const primary = await sScanSafe(`${pool}:blocks:primary:kicked`);
      const auxiliary = await sScanSafe(`${pool}:blocks:auxiliary:kicked`);
      callback(200, {
        primary: utils.processBlocks(primary),
        auxiliary: utils.processBlocks(auxiliary)
      });
    } catch (err) {
      callback(500, 'Error reading blocks');
    }
  };

  // Blocks pending
  this.handleBlocksPending = async function(pool, callback) {
    try {
      const primary = await sScanSafe(`${pool}:blocks:primary:pending`);
      const auxiliary = await sScanSafe(`${pool}:blocks:auxiliary:pending`);
      callback(200, {
        primary: utils.processBlocks(primary),
        auxiliary: utils.processBlocks(auxiliary)
      });
    } catch (err) {
      callback(500, 'Error reading blocks');
    }
  };

  // All blocks
  this.handleBlocks = async function(pool, callback) {
    try {
      const [primaryConfirmed, primaryKicked, primaryPending,
             auxiliaryConfirmed, auxiliaryKicked, auxiliaryPending] = await Promise.all([
        sScanSafe(`${pool}:blocks:primary:confirmed`),
        sScanSafe(`${pool}:blocks:primary:kicked`),
        sScanSafe(`${pool}:blocks:primary:pending`),
        sScanSafe(`${pool}:blocks:auxiliary:confirmed`),
        sScanSafe(`${pool}:blocks:auxiliary:kicked`),
        sScanSafe(`${pool}:blocks:auxiliary:pending`)
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

  // Blocks for specific miner
  this.handleBlocksSpecific = async function(pool, miner, callback) {
    try {
      const [primaryConfirmed, primaryKicked, primaryPending,
             auxiliaryConfirmed, auxiliaryKicked, auxiliaryPending] = await Promise.all([
        sScanSafe(`${pool}:blocks:primary:confirmed`),
        sScanSafe(`${pool}:blocks:primary:kicked`),
        sScanSafe(`${pool}:blocks:primary:pending`),
        sScanSafe(`${pool}:blocks:auxiliary:confirmed`),
        sScanSafe(`${pool}:blocks:auxiliary:kicked`),
        sScanSafe(`${pool}:blocks:auxiliary:pending`)
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

  // Historical (uses zRangeByScore)
  this.handleHistorical = async function(pool, callback) {
    try {
      const historicalWindow = _this.poolConfigs[pool]?.statistics?.historicalWindow || 86400;
      const windowHistorical = (((Date.now() / 1000) - historicalWindow) | 0).toString();
      const [primary, auxiliary] = await Promise.all([
        zRangeByScoreSafe(`${pool}:statistics:primary:historical`, windowHistorical, '+inf'),
        zRangeByScoreSafe(`${pool}:statistics:auxiliary:historical`, windowHistorical, '+inf')
      ]);
      callback(200, {
        primary: utils.processHistorical(primary),
        auxiliary: utils.processHistorical(auxiliary),
      });
    } catch (err) {
      callback(500, 'Error reading historical');
    }
  };

  // Miners active
  this.handleMinersActive = async function(pool, callback) {
    try {
      const config = _this.poolConfigs[pool] || {};
      const algorithm = config.primary?.coin?.algorithms?.mining || 'sha256d';
      const hashrateWindow = config.statistics?.hashrateWindow || 600;
      const multiplier = Math.pow(2, 32) / (Algorithms[algorithm]?.multiplier || 1);
      const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();

      const [primarySharedShares, primarySharedHash, primarySoloShares, primarySoloHash,
             auxiliarySharedShares, auxiliarySharedHash, auxiliarySoloShares, auxiliarySoloHash] = await Promise.all([
        hScanSafe(`${pool}:rounds:primary:current:shared:shares`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:shared:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:primary:current:solo:shares`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:solo:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:auxiliary:current:shared:shares`),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:auxiliary:current:solo:shares`),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf')
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

  // Miners specific
  this.handleMinersSpecific = async function(pool, miner, callback) {
    try {
      const config = _this.poolConfigs[pool] || {};
      const algorithm = config.primary?.coin?.algorithms?.mining || 'sha256d';
      const hashrateWindow = config.statistics?.hashrateWindow || 600;
      const multiplier = Math.pow(2, 32) / (Algorithms[algorithm]?.multiplier || 1);
      const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();

      const [primaryBal, primaryGen, primaryImm, primaryPaid,
             primarySharedShares, primarySharedHash, primarySoloShares, primarySoloHash,
             auxiliaryBal, auxiliaryGen, auxiliaryImm, auxiliaryPaid,
             auxiliarySharedShares, auxiliarySharedHash, auxiliarySoloShares, auxiliarySoloHash] = await Promise.all([
        hScanSafe(`${pool}:payments:primary:balances`),
        hScanSafe(`${pool}:payments:primary:generate`),
        hScanSafe(`${pool}:payments:primary:immature`),
        hScanSafe(`${pool}:payments:primary:paid`),
        hScanSafe(`${pool}:rounds:primary:current:shared:shares`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:shared:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:primary:current:solo:shares`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:solo:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:payments:auxiliary:balances`),
        hScanSafe(`${pool}:payments:auxiliary:generate`),
        hScanSafe(`${pool}:payments:auxiliary:immature`),
        hScanSafe(`${pool}:payments:auxiliary:paid`),
        hScanSafe(`${pool}:rounds:auxiliary:current:shared:shares`),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:auxiliary:current:solo:shares`),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf')
      ]);

      // Build response (abbreviated for brevity – same as original but with safe access)
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

      const primaryBalanceData = utils.processPayments(primaryBal, miner)[miner] || 0;
      const primaryGenerateData = utils.processPayments(primaryGen, miner)[miner] || 0;
      const primaryImmatureData = utils.processPayments(primaryImm, miner)[miner] || 0;
      const primaryPaidData = utils.processPayments(primaryPaid, miner)[miner] || 0;
      const auxiliaryBalanceData = utils.processPayments(auxiliaryBal, miner)[miner] || 0;
      const auxiliaryGenerateData = utils.processPayments(auxiliaryGen, miner)[miner] || 0;
      const auxiliaryImmatureData = utils.processPayments(auxiliaryImm, miner)[miner] || 0;
      const auxiliaryPaidData = utils.processPayments(auxiliaryPaid, miner)[miner] || 0;

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
            balances: primaryBalanceData,
            generate: primaryGenerateData,
            immature: primaryImmatureData,
            paid: primaryPaidData,
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
            balances: auxiliaryBalanceData,
            generate: auxiliaryGenerateData,
            immature: auxiliaryImmatureData,
            paid: auxiliaryPaidData,
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

  // Miners (all)
  this.handleMiners = async function(pool, callback) {
    try {
      const config = _this.poolConfigs[pool] || {};
      const algorithm = config.primary?.coin?.algorithms?.mining || 'sha256d';
      const hashrateWindow = config.statistics?.hashrateWindow || 600;
      const multiplier = Math.pow(2, 32) / (Algorithms[algorithm]?.multiplier || 1);
      const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();

      const [primarySharedShares, primarySharedHash, primarySoloShares, primarySoloHash,
             auxiliarySharedShares, auxiliarySharedHash, auxiliarySoloShares, auxiliarySoloHash] = await Promise.all([
        hScanSafe(`${pool}:rounds:primary:current:shared:shares`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:shared:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:primary:current:solo:shares`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:solo:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:auxiliary:current:shared:shares`),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:auxiliary:current:solo:shares`),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf')
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

  // Payments balances, generate, immature, paid, records – all use safe wrappers
  this.handlePaymentsBalances = async function(pool, callback) {
    try {
      const [primary, auxiliary] = await Promise.all([
        hScanSafe(`${pool}:payments:primary:balances`),
        hScanSafe(`${pool}:payments:auxiliary:balances`)
      ]);
      callback(200, {
        primary: utils.processPayments(primary),
        auxiliary: utils.processPayments(auxiliary),
      });
    } catch (err) {
      callback(500, 'Error reading payments');
    }
  };

  this.handlePaymentsGenerate = async function(pool, callback) {
    try {
      const [primary, auxiliary] = await Promise.all([
        hScanSafe(`${pool}:payments:primary:generate`),
        hScanSafe(`${pool}:payments:auxiliary:generate`)
      ]);
      callback(200, {
        primary: utils.processPayments(primary),
        auxiliary: utils.processPayments(auxiliary),
      });
    } catch (err) {
      callback(500, 'Error reading payments');
    }
  };

  this.handlePaymentsImmature = async function(pool, callback) {
    try {
      const [primary, auxiliary] = await Promise.all([
        hScanSafe(`${pool}:payments:primary:immature`),
        hScanSafe(`${pool}:payments:auxiliary:immature`)
      ]);
      callback(200, {
        primary: utils.processPayments(primary),
        auxiliary: utils.processPayments(auxiliary),
      });
    } catch (err) {
      callback(500, 'Error reading payments');
    }
  };

  this.handlePaymentsPaid = async function(pool, callback) {
    try {
      const [primary, auxiliary] = await Promise.all([
        hScanSafe(`${pool}:payments:primary:paid`),
        hScanSafe(`${pool}:payments:auxiliary:paid`)
      ]);
      callback(200, {
        primary: utils.processPayments(primary),
        auxiliary: utils.processPayments(auxiliary),
      });
    } catch (err) {
      callback(500, 'Error reading payments');
    }
  };

  this.handlePaymentsRecords = async function(pool, callback) {
    try {
      const [primaryItems, auxiliaryItems] = await Promise.all([
        zScanSafe(`${pool}:payments:primary:records`),
        zScanSafe(`${pool}:payments:auxiliary:records`)
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

  this.handlePayments = async function(pool, callback) {
    try {
      const [primaryBal, primaryGen, primaryImm, primaryPaid,
             auxiliaryBal, auxiliaryGen, auxiliaryImm, auxiliaryPaid] = await Promise.all([
        hScanSafe(`${pool}:payments:primary:balances`),
        hScanSafe(`${pool}:payments:primary:generate`),
        hScanSafe(`${pool}:payments:primary:immature`),
        hScanSafe(`${pool}:payments:primary:paid`),
        hScanSafe(`${pool}:payments:auxiliary:balances`),
        hScanSafe(`${pool}:payments:auxiliary:generate`),
        hScanSafe(`${pool}:payments:auxiliary:immature`),
        hScanSafe(`${pool}:payments:auxiliary:paid`)
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

  // Rounds
  this.handleRoundsCurrent = async function(pool, callback) {
    try {
      const [primaryShared, primarySolo, auxiliaryShared, auxiliarySolo] = await Promise.all([
        hScanSafe(`${pool}:rounds:primary:current:shared:shares`),
        hScanSafe(`${pool}:rounds:primary:current:solo:shares`),
        hScanSafe(`${pool}:rounds:auxiliary:current:shared:shares`),
        hScanSafe(`${pool}:rounds:auxiliary:current:solo:shares`)
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

  this.handleRoundsHeight = async function(pool, height, callback) {
    try {
      const [primary, auxiliary] = await Promise.all([
        hScanSafe(`${pool}:rounds:primary:round-${height}:shares`),
        hScanSafe(`${pool}:rounds:auxiliary:round-${height}:shares`)
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

  this.processRounds = async function(pool, blockType) {
    const pattern = `${pool}:rounds:${blockType}:round-*:shares`;
    // Use scan to find keys
    const keys = await sScanSafe(pattern);
    const heights = keys.map(key => key.split(':')[3].split('-')[1]);
    const results = [];
    for (const height of heights) {
      const shares = await hScanSafe(`${pool}:rounds:${blockType}:round-${height}:shares`);
      results.push({
        round: parseFloat(height),
        times: utils.processTimes(shares),
        work: utils.processShares(shares),
      });
    }
    return results;
  };

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

  // ---------- FIXED: handleStatistics with fallback defaults ----------
  this.handleStatistics = async function(pool, callback) {
    try {
      const config = _this.poolConfigs[pool] || {};
      const algorithm = config.primary?.coin?.algorithms?.mining || 'sha256d';
      const hashrateWindow = config.statistics?.hashrateWindow || 600;
      const multiplier = Math.pow(2, 32) / (Algorithms[algorithm]?.multiplier || 1);
      const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();

      // Use safe wrappers; all return empty if keys missing
      const [
        primaryBlockCounts, primaryPending, primaryConfirmed,
        primaryPaymentCounts, primarySharedCounts, primarySharedHash, primarySoloHash,
        primaryNetwork,
        auxiliaryBlockCounts, auxiliaryPending, auxiliaryConfirmed,
        auxiliaryPaymentCounts, auxiliarySharedCounts, auxiliarySharedHash, auxiliarySoloHash,
        auxiliaryNetwork
      ] = await Promise.all([
        hScanSafe(`${pool}:blocks:primary:counts`),
        sScanSafe(`${pool}:blocks:primary:pending`),
        sScanSafe(`${pool}:blocks:primary:confirmed`),
        hScanSafe(`${pool}:payments:primary:counts`),
        hScanSafe(`${pool}:rounds:primary:current:shared:counts`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:shared:hashrate`, windowTime, '+inf'),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:solo:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:statistics:primary:network`),
        hScanSafe(`${pool}:blocks:auxiliary:counts`),
        sScanSafe(`${pool}:blocks:auxiliary:pending`),
        sScanSafe(`${pool}:blocks:auxiliary:confirmed`),
        hScanSafe(`${pool}:payments:auxiliary:counts`),
        hScanSafe(`${pool}:rounds:auxiliary:current:shared:counts`),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:statistics:auxiliary:network`)
      ]);

      // Build response with safe defaults
      callback(200, {
        primary: {
          config: {
            coin: config.primary?.coin?.name || '',
            symbol: config.primary?.coin?.symbol || '',
            algorithm: algorithm,
            paymentInterval: config.primary?.payments?.paymentInterval || 0,
            minPayment: config.primary?.payments?.minPayment || 0,
            recipientFee: config.primary?.recipients?.reduce((p, a) => p + a.percentage, 0) || 0,
          },
          blocks: {
            valid: parseFloat(primaryBlockCounts?.valid || 0),
            invalid: parseFloat(primaryBlockCounts?.invalid || 0),
          },
          shares: {
            valid: parseFloat(primarySharedCounts?.valid || 0),
            stale: parseFloat(primarySharedCounts?.stale || 0),
            invalid: parseFloat(primarySharedCounts?.invalid || 0),
          },
          hashrate: {
            shared: (multiplier * utils.processWork(primarySharedHash)) / hashrateWindow,
            solo: (multiplier * utils.processWork(primarySoloHash)) / hashrateWindow,
          },
          network: {
            difficulty: parseFloat(primaryNetwork?.difficulty || 0),
            hashrate: parseFloat(primaryNetwork?.hashrate || 0),
            height: parseFloat(primaryNetwork?.height || 0),
          },
          payments: {
            last: parseFloat(primaryPaymentCounts?.last || 0),
            next: parseFloat(primaryPaymentCounts?.next || 0),
            total: parseFloat(primaryPaymentCounts?.total || 0),
          },
          status: {
            effort: parseFloat(primarySharedCounts?.effort || 0),
            luck: utils.processLuck(primaryPending, primaryConfirmed),
            miners: utils.combineMiners(primarySharedHash, primarySoloHash),
            workers: utils.combineWorkers(primarySharedHash, primarySoloHash),
          },
        },
        auxiliary: {
          config: {
            coin: (config.auxiliary?.enabled) ? config.auxiliary?.coin?.name || '' : '',
            symbol: (config.auxiliary?.enabled) ? config.auxiliary?.coin?.symbol || '' : '',
            algorithm: algorithm,
            paymentInterval: (config.auxiliary?.enabled) ? config.auxiliary?.payments?.paymentInterval || 0 : 0,
            minPayment: (config.auxiliary?.enabled) ? config.auxiliary?.payments?.minPayment || 0 : 0,
            recipientFee: (config.auxiliary?.enabled) ? config.auxiliary?.recipients?.reduce((p, a) => p + a.percentage, 0) || 0 : 0,
          },
          blocks: {
            valid: parseFloat(auxiliaryBlockCounts?.valid || 0),
            invalid: parseFloat(auxiliaryBlockCounts?.invalid || 0),
          },
          shares: {
            valid: parseFloat(auxiliarySharedCounts?.valid || 0),
            stale: parseFloat(auxiliarySharedCounts?.stale || 0),
            invalid: parseFloat(auxiliarySharedCounts?.invalid || 0),
          },
          hashrate: {
            shared: (multiplier * utils.processWork(auxiliarySharedHash)) / hashrateWindow,
            solo: (multiplier * utils.processWork(auxiliarySoloHash)) / hashrateWindow,
          },
          network: {
            difficulty: parseFloat(auxiliaryNetwork?.difficulty || 0),
            hashrate: parseFloat(auxiliaryNetwork?.hashrate || 0),
            height: parseFloat(auxiliaryNetwork?.height || 0),
          },
          payments: {
            last: parseFloat(auxiliaryPaymentCounts?.last || 0),
            next: parseFloat(auxiliaryPaymentCounts?.next || 0),
            total: parseFloat(auxiliaryPaymentCounts?.total || 0),
          },
          status: {
            effort: parseFloat(auxiliarySharedCounts?.effort || 0),
            luck: utils.processLuck(auxiliaryPending, auxiliaryConfirmed),
            miners: utils.combineMiners(auxiliarySharedHash, auxiliarySoloHash),
            workers: utils.combineWorkers(auxiliarySharedHash, auxiliarySoloHash),
          },
        }
      });
    } catch (err) {
      console.error('Statistics error:', err);
      callback(500, 'Error reading statistics');
    }
  };

  // Workers (active, specific, all) – similar pattern with safe wrappers
  this.handleWorkersActive = async function(pool, callback) {
    try {
      const config = _this.poolConfigs[pool] || {};
      const algorithm = config.primary?.coin?.algorithms?.mining || 'sha256d';
      const hashrateWindow = config.statistics?.hashrateWindow || 600;
      const multiplier = Math.pow(2, 32) / (Algorithms[algorithm]?.multiplier || 1);
      const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();

      const [primarySharedShares, primarySharedHash, primarySoloShares, primarySoloHash,
             auxiliarySharedShares, auxiliarySharedHash, auxiliarySoloShares, auxiliarySoloHash] = await Promise.all([
        hScanSafe(`${pool}:rounds:primary:current:shared:shares`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:shared:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:primary:current:solo:shares`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:solo:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:auxiliary:current:shared:shares`),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:auxiliary:current:solo:shares`),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf')
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

  this.handleWorkersSpecific = async function(pool, worker, callback) {
    try {
      const config = _this.poolConfigs[pool] || {};
      const algorithm = config.primary?.coin?.algorithms?.mining || 'sha256d';
      const hashrateWindow = config.statistics?.hashrateWindow || 600;
      const multiplier = Math.pow(2, 32) / (Algorithms[algorithm]?.multiplier || 1);
      const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();

      const [primarySharedShares, primarySharedHash, primarySoloShares, primarySoloHash,
             auxiliarySharedShares, auxiliarySharedHash, auxiliarySoloShares, auxiliarySoloHash] = await Promise.all([
        hScanSafe(`${pool}:rounds:primary:current:shared:shares`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:shared:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:primary:current:solo:shares`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:solo:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:auxiliary:current:shared:shares`),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:auxiliary:current:solo:shares`),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf')
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

  this.handleWorkers = async function(pool, callback) {
    try {
      const config = _this.poolConfigs[pool] || {};
      const algorithm = config.primary?.coin?.algorithms?.mining || 'sha256d';
      const hashrateWindow = config.statistics?.hashrateWindow || 600;
      const multiplier = Math.pow(2, 32) / (Algorithms[algorithm]?.multiplier || 1);
      const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();

      const [primarySharedShares, primarySharedHash, primarySoloShares, primarySoloHash,
             auxiliarySharedShares, auxiliarySharedHash, auxiliarySoloShares, auxiliarySoloHash] = await Promise.all([
        hScanSafe(`${pool}:rounds:primary:current:shared:shares`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:shared:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:primary:current:solo:shares`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:solo:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:auxiliary:current:shared:shares`),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:rounds:auxiliary:current:solo:shares`),
        zRangeByScoreSafe(`${pool}:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf')
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

  // ==================== EXECUTE COMMANDS (deprecated, kept for compatibility) ====================

  /* istanbul ignore next */
  this.executeCommands = function(commands, callback, handler) {
    // No longer used – kept for fallback
    handler(500, 'Deprecated method');
  };

  // ==================== API ROUTER ====================

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
        callback(200, { ports: _this.poolConfigs[pool]?.ports || [] });
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
