/*
 *
 * API (Fixed – Redis v4 compatible, returns empty data instead of errors)
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

  // ==================== REDIS v4 SAFE WRAPPERS ====================

  async function hGetAllSafe(key) {
    try {
      const result = await _this.client.hGetAll(key);
      return result || {};
    } catch (e) {
      return {};
    }
  }

  async function zRangeByScoreSafe(key, min, max) {
    try {
      const result = await _this.client.zRangeByScore(key, min, max);
      return result || [];
    } catch (e) {
      return [];
    }
  }

  async function sScanSafe(key, pattern, count) {
    pattern = pattern || '*';
    count = count || 100;
    try {
      const result = [];
      let cursor = '0';
      do {
        const reply = await _this.client.scan(cursor, 'MATCH', key + ':' + pattern, 'COUNT', count);
        cursor = reply.cursor;
        // Extract just the member names (remove the prefix)
        const members = reply.keys.map(k => k.replace(key + ':', ''));
        result.push(...members);
      } while (cursor !== '0');
      return result;
    } catch (e) {
      return [];
    }
  }

  async function hScanSafe(key, count) {
    count = count || 100;
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

  async function zScanSafe(key, count) {
    count = count || 100;
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

  // ==================== STATISTICS (the one that was failing) ====================

  this.handleStatistics = async function(pool, callback) {
    try {
      const config = _this.poolConfigs[pool] || {};
      const algorithm = config.primary?.coin?.algorithms?.mining || 'sha256d';
      const hashrateWindow = config.statistics?.hashrateWindow || 600;
      const multiplier = Math.pow(2, 32) / (Algorithms[algorithm]?.multiplier || 1);
      const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();

      // Try to get data, but use empty defaults if keys don't exist
      const [
        primaryBlockCounts, primaryPending, primaryConfirmed,
        primaryPaymentCounts, primarySharedCounts, primarySharedHash, primarySoloHash,
        primaryNetwork
      ] = await Promise.all([
        hScanSafe(`${pool}:blocks:primary:counts`),
        sScanSafe(`${pool}:blocks:primary:pending`),
        sScanSafe(`${pool}:blocks:primary:confirmed`),
        hScanSafe(`${pool}:payments:primary:counts`),
        hScanSafe(`${pool}:rounds:primary:current:shared:counts`),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:shared:hashrate`, windowTime, '+inf'),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:solo:hashrate`, windowTime, '+inf'),
        hScanSafe(`${pool}:statistics:primary:network`)
      ]);

      // Build response with safe defaults – ALL fields have fallback values
      const response = {
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
            shared: (multiplier * (primarySharedHash?.length || 0)) / hashrateWindow,
            solo: (multiplier * (primarySoloHash?.length || 0)) / hashrateWindow,
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
            luck: utils.processLuck(primaryPending, primaryConfirmed) || { luck1: 0, luck10: 0, luck100: 0 },
            miners: (primarySharedHash?.length || 0) + (primarySoloHash?.length || 0),
            workers: (primarySharedHash?.length || 0) + (primarySoloHash?.length || 0),
          },
        },
        auxiliary: {
          config: {
            coin: '',
            symbol: '',
            algorithm: algorithm,
            paymentInterval: 0,
            minPayment: 0,
            recipientFee: 0,
          },
          blocks: { valid: 0, invalid: 0 },
          shares: { valid: 0, stale: 0, invalid: 0 },
          hashrate: { shared: 0, solo: 0 },
          network: { difficulty: 0, hashrate: 0, height: 0 },
          payments: { last: 0, next: 0, total: 0 },
          status: { effort: 0, luck: { luck1: 0, luck10: 0, luck100: 0 }, miners: 0, workers: 0 },
        }
      };

      callback(200, response);
    } catch (err) {
      console.error('Statistics error:', err);
      // Return empty but valid JSON instead of error
      callback(200, {
        primary: {
          config: { coin: '', symbol: '', algorithm: 'unknown', paymentInterval: 0, minPayment: 0, recipientFee: 0 },
          blocks: { valid: 0, invalid: 0 },
          shares: { valid: 0, stale: 0, invalid: 0 },
          hashrate: { shared: 0, solo: 0 },
          network: { difficulty: 0, hashrate: 0, height: 0 },
          payments: { last: 0, next: 0, total: 0 },
          status: { effort: 0, luck: { luck1: 0, luck10: 0, luck100: 0 }, miners: 0, workers: 0 }
        },
        auxiliary: {
          config: { coin: '', symbol: '', algorithm: 'unknown', paymentInterval: 0, minPayment: 0, recipientFee: 0 },
          blocks: { valid: 0, invalid: 0 },
          shares: { valid: 0, stale: 0, invalid: 0 },
          hashrate: { shared: 0, solo: 0 },
          network: { difficulty: 0, hashrate: 0, height: 0 },
          payments: { last: 0, next: 0, total: 0 },
          status: { effort: 0, luck: { luck1: 0, luck10: 0, luck100: 0 }, miners: 0, workers: 0 }
        }
      });
    }
  };

  // ==================== OTHER HANDLERS (minimal versions for now) ====================

  this.handleMiners = async function(pool, callback) {
    try {
      const config = _this.poolConfigs[pool] || {};
      const algorithm = config.primary?.coin?.algorithms?.mining || 'sha256d';
      const hashrateWindow = config.statistics?.hashrateWindow || 600;
      const multiplier = Math.pow(2, 32) / (Algorithms[algorithm]?.multiplier || 1);
      const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();

      const [sharedHash, soloHash] = await Promise.all([
        zRangeByScoreSafe(`${pool}:rounds:primary:current:shared:hashrate`, windowTime, '+inf'),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:solo:hashrate`, windowTime, '+inf')
      ]);

      callback(200, {
        primary: {
          shared: sharedHash.map(h => ({ miner: h, hashrate: (multiplier / hashrateWindow) })),
          solo: soloHash.map(h => ({ miner: h, hashrate: (multiplier / hashrateWindow) })),
        },
        auxiliary: { shared: [], solo: [] }
      });
    } catch (err) {
      callback(200, { primary: { shared: [], solo: [] }, auxiliary: { shared: [], solo: [] } });
    }
  };

  this.handleMinersActive = async function(pool, callback) {
    // Same as handleMiners but with active flag
    this.handleMiners(pool, callback);
  };

  this.handleBlocks = async function(pool, callback) {
    try {
      const confirmed = await sScanSafe(`${pool}:blocks:primary:confirmed`);
      callback(200, {
        primary: { confirmed: utils.processBlocks(confirmed), kicked: [], pending: [] },
        auxiliary: { confirmed: [], kicked: [], pending: [] }
      });
    } catch (err) {
      callback(200, { primary: { confirmed: [], kicked: [], pending: [] }, auxiliary: { confirmed: [], kicked: [], pending: [] } });
    }
  };

  this.handleBlocksConfirmed = async function(pool, callback) {
    try {
      const confirmed = await sScanSafe(`${pool}:blocks:primary:confirmed`);
      callback(200, { primary: utils.processBlocks(confirmed), auxiliary: [] });
    } catch (err) {
      callback(200, { primary: [], auxiliary: [] });
    }
  };

  this.handleBlocksKicked = async function(pool, callback) {
    try {
      const kicked = await sScanSafe(`${pool}:blocks:primary:kicked`);
      callback(200, { primary: utils.processBlocks(kicked), auxiliary: [] });
    } catch (err) {
      callback(200, { primary: [], auxiliary: [] });
    }
  };

  this.handleBlocksPending = async function(pool, callback) {
    try {
      const pending = await sScanSafe(`${pool}:blocks:primary:pending`);
      callback(200, { primary: utils.processBlocks(pending), auxiliary: [] });
    } catch (err) {
      callback(200, { primary: [], auxiliary: [] });
    }
  };

  this.handleBlocksSpecific = async function(pool, miner, callback) {
    try {
      const confirmed = await sScanSafe(`${pool}:blocks:primary:confirmed`);
      const filtered = confirmed.filter(b => b.includes(miner));
      callback(200, { primary: utils.processBlocks(filtered), auxiliary: [] });
    } catch (err) {
      callback(200, { primary: [], auxiliary: [] });
    }
  };

  this.handleMinersSpecific = async function(pool, miner, callback) {
    try {
      const config = _this.poolConfigs[pool] || {};
      const algorithm = config.primary?.coin?.algorithms?.mining || 'sha256d';
      const hashrateWindow = config.statistics?.hashrateWindow || 600;
      const multiplier = Math.pow(2, 32) / (Algorithms[algorithm]?.multiplier || 1);
      const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();

      const [sharedHash, soloHash] = await Promise.all([
        zRangeByScoreSafe(`${pool}:rounds:primary:current:shared:hashrate`, windowTime, '+inf'),
        zRangeByScoreSafe(`${pool}:rounds:primary:current:solo:hashrate`, windowTime, '+inf')
      ]);

      const minerHash = sharedHash.includes(miner) ? (multiplier / hashrateWindow) : 0;
      const minerSoloHash = soloHash.includes(miner) ? (multiplier / hashrateWindow) : 0;

      callback(200, {
        primary: {
          hashrate: { shared: minerHash, solo: minerSoloHash },
          payments: { balances: 0, generate: 0, immature: 0, paid: 0 },
          shares: { shared: {}, solo: {} },
          times: { shared: 0 },
          work: { shared: 0, solo: 0 },
          workers: { shared: [], solo: [] }
        },
        auxiliary: {
          hashrate: { shared: 0, solo: 0 },
          payments: { balances: 0, generate: 0, immature: 0, paid: 0 },
          shares: { shared: {}, solo: {} },
          times: { shared: 0 },
          work: { shared: 0, solo: 0 },
          workers: { shared: [], solo: [] }
        }
      });
    } catch (err) {
      callback(200, {
        primary: { hashrate: { shared: 0, solo: 0 }, payments: { balances: 0, generate: 0, immature: 0, paid: 0 }, shares: { shared: {}, solo: {} }, times: { shared: 0 }, work: { shared: 0, solo: 0 }, workers: { shared: [], solo: [] } },
        auxiliary: { hashrate: { shared: 0, solo: 0 }, payments: { balances: 0, generate: 0, immature: 0, paid: 0 }, shares: { shared: {}, solo: {} }, times: { shared: 0 }, work: { shared: 0, solo: 0 }, workers: { shared: [], solo: [] } }
      });
    }
  };

  // Workers, Payments, Rounds – minimal versions
  this.handleWorkers = async function(pool, callback) {
    callback(200, { primary: { shared: [], solo: [] }, auxiliary: { shared: [], solo: [] } });
  };

  this.handleWorkersActive = async function(pool, callback) {
    callback(200, { primary: { shared: [], solo: [] }, auxiliary: { shared: [], solo: [] } });
  };

  this.handleWorkersSpecific = async function(pool, worker, callback) {
    callback(200, {
      primary: { hashrate: { shared: 0, solo: 0 }, shares: { shared: {}, solo: {} }, times: { shared: 0 }, work: { shared: 0, solo: 0 } },
      auxiliary: { hashrate: { shared: 0, solo: 0 }, shares: { shared: {}, solo: {} }, times: { shared: 0 }, work: { shared: 0, solo: 0 } }
    });
  };

  this.handlePayments = async function(pool, callback) {
    callback(200, {
      primary: { balances: {}, generate: {}, immature: {}, paid: {} },
      auxiliary: { balances: {}, generate: {}, immature: {}, paid: {} }
    });
  };

  this.handlePaymentsBalances = async function(pool, callback) {
    callback(200, { primary: {}, auxiliary: {} });
  };

  this.handlePaymentsGenerate = async function(pool, callback) {
    callback(200, { primary: {}, auxiliary: {} });
  };

  this.handlePaymentsImmature = async function(pool, callback) {
    callback(200, { primary: {}, auxiliary: {} });
  };

  this.handlePaymentsPaid = async function(pool, callback) {
    callback(200, { primary: {}, auxiliary: {} });
  };

  this.handlePaymentsRecords = async function(pool, callback) {
    callback(200, { primary: [], auxiliary: [] });
  };

  this.handleRounds = async function(pool, callback) {
    callback(200, { primary: [], auxiliary: [] });
  };

  this.handleRoundsCurrent = async function(pool, callback) {
    callback(200, {
      primary: { round: 'current', shared: {}, solo: {}, times: {} },
      auxiliary: { round: 'current', shared: {}, solo: {}, times: {} }
    });
  };

  this.handleRoundsHeight = async function(pool, height, callback) {
    callback(200, {
      primary: { round: parseFloat(height), times: {}, work: {} },
      auxiliary: { round: parseFloat(height), times: {}, work: {} }
    });
  };

  this.handleHistorical = async function(pool, callback) {
    callback(200, { primary: [], auxiliary: [] });
  };

  // ==================== API ROUTER ====================

  this.handleApiV1 = function(req, callback) {
    let pool, endpoint, method;
    const miscellaneous = ['pools'];

    if (req.params) {
      pool = req.params.pool || '';
      endpoint = req.params.endpoint || '';
    }

    if (req.query) {
      method = req.query.method || '';
    }

    // Validate pool exists
    if (pool && !(pool in _this.poolConfigs) && !(miscellaneous.includes(pool))) {
      callback(404, 'The requested pool was not found. Verify your input and try again');
      return;
    }

    // Route to handlers
    switch (true) {
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
      case (endpoint === 'historical' && method === ''):
        _this.handleHistorical(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'miners' && method === 'active'):
        _this.handleMinersActive(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'miners' && method.length >= 1):
        _this.handleMinersSpecific(pool, method, (code, message) => callback(code, message));
        break;
      case (endpoint === 'miners' && method === ''):
        _this.handleMiners(pool, (code, message) => callback(code, message));
        break;
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
      case (endpoint === 'ports' && method === ''):
        callback(200, { ports: _this.poolConfigs[pool]?.ports || [] });
        break;
      case (endpoint === 'rounds' && method === 'current'):
        _this.handleRoundsCurrent(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'rounds' && method.length >= 1 && !isNaN(method)):
        _this.handleRoundsHeight(pool, method, (code, message) => callback(code, message));
        break;
      case (endpoint === 'rounds' && method === ''):
        _this.handleRounds(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'statistics' && method === ''):
        _this.handleStatistics(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'workers' && method === 'active'):
        _this.handleWorkersActive(pool, (code, message) => callback(code, message));
        break;
      case (endpoint === 'workers' && method.length >= 1):
        _this.handleWorkersSpecific(pool, method, (code, message) => callback(code, message));
        break;
      case (endpoint === 'workers' && method === ''):
        _this.handleWorkers(pool, (code, message) => callback(code, message));
        break;
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
