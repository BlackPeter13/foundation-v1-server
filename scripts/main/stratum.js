/*
 *
 * Stratum (Updated) – with address caching and async improvements
 *
 */

const Stratum = require('foundation-stratum');
const NodeCache = require('node-cache'); // optional, but recommended

////////////////////////////////////////////////////////////////////////////////

// Main Stratum Function
const PoolStratum = function (logger, poolConfig, portalConfig, poolShares, poolStatistics) {

  const _this = this;
  process.setMaxListeners(0);

  this.pool = poolConfig.name;
  this.poolConfig = poolConfig;
  this.portalConfig = portalConfig;
  this.poolShares = poolShares;
  this.poolStatistics = poolStatistics;
  this.forkId = process.env.forkId;

  // Address cache: TTL 5 minutes, max 1000 entries (to avoid memory growth)
  // Using a simple Map with expiration for simplicity, or use node-cache
  this.addressCache = new Map();
  this.cacheTTL = 5 * 60 * 1000; // 5 minutes

  const logSystem = 'Pool';
  const logComponent = poolConfig.name;
  const logSubCat = `Thread ${ parseInt(_this.forkId) + 1 }`;

  // Determine Block Viability (unchanged)
  this.checkPrimary = function(shareData, blockValid) {
    if (shareData.blockType === 'primary' && !blockValid && shareData.transaction) {
      logger.error(logSystem, logComponent, logSubCat, 'We thought a primary block was found but it was rejected by the daemon.');
    } else if (shareData.blockType === 'primary' && blockValid) {
      logger.special(logSystem, logComponent, logSubCat, `Primary block found: ${ shareData.hash } by ${ shareData.addrPrimary }`);
    }
  };

  // Determine Block Viability
  this.checkAuxiliary = function(shareData, blockValid) {
    if (shareData.blockType === 'auxiliary' && !blockValid) {
      logger.error(logSystem, logComponent, logSubCat, 'We thought an auxiliary block was found but it was rejected by the daemon.');
    } else if (shareData.blockType === 'auxiliary' && blockValid) {
      logger.special(logSystem, logComponent, logSubCat, `Auxiliary block found: ${ shareData.hash } by ${ shareData.addrAuxiliary }`);
    }
  };

  // Determine Share Viability
  this.checkShare = function(shareData, shareType) {
    if (['stale', 'invalid'].includes(shareType)) {
      logger.debug(logSystem, logComponent, logSubCat, 'We thought a share was found but it was rejected by the daemon.');
    } else if (shareData.blockType !== 'auxiliary') {
      logger.debug(logSystem, logComponent, logSubCat, `Share accepted at difficulty ${ shareData.difficulty }/${ shareData.shareDiff } by ${ shareData.addrPrimary } [${ shareData.ip }]`);
    }
  };

  // Cache helper
  this.getCachedValidation = function(addr) {
    const entry = _this.addressCache.get(addr);
    if (entry && entry.expiry > Date.now()) {
      return entry.valid;
    }
    return undefined; // not cached or expired
  };

  this.setCachedValidation = function(addr, valid) {
    _this.addressCache.set(addr, { valid, expiry: Date.now() + _this.cacheTTL });
    // Limit cache size – if > 1000, delete oldest (or use LRU)
    if (_this.addressCache.size > 1000) {
      const oldest = _this.addressCache.keys().next().value;
      _this.addressCache.delete(oldest);
    }
  };

  // Check for Valid Primary Worker Address (with cache)
  this.checkPrimaryWorker = function(workerName, callback) {
    const address = workerName.split('.')[0];
    const cached = _this.getCachedValidation(address);
    if (cached !== undefined) {
      return callback(cached);
    }
    // Not cached, ask daemon
    _this.poolStratum.primary.daemon.cmd('validateaddress', [address], false, (results) => {
      const isValid = results.some(result => result.response.isvalid);
      _this.setCachedValidation(address, isValid);
      callback(isValid);
    });
  };

  // Check for Valid Auxiliary Worker Address (with cache)
  this.checkAuxiliaryWorker = function(workerName, callback) {
    if (workerName && _this.poolConfig.auxiliary && _this.poolConfig.auxiliary.enabled) {
      const address = workerName.split('.')[0];
      const cached = _this.getCachedValidation(address);
      if (cached !== undefined) {
        return callback(cached);
      }
      _this.poolStratum.auxiliary.daemon.cmd('validateaddress', [address], false, (results) => {
        const isValid = results.some(result => result.response.isvalid);
        _this.setCachedValidation(address, isValid);
        callback(isValid);
      });
    } else if (_this.poolConfig.auxiliary && _this.poolConfig.auxiliary.enabled) {
      callback(false);
    } else {
      callback(true);
    }
  };

  // Handle Worker Authentication
  this.authorizeWorker = function(ip, port, addrPrimary, addrAuxiliary, password, callback) {
    // Use async/await style with callbacks (keep signature)
    _this.checkAuxiliaryWorker(addrAuxiliary, (auxAuthorized) => {
      if (auxAuthorized) {
        _this.checkPrimaryWorker(addrPrimary, (primaryAuthorized) => {
          const authString = primaryAuthorized ? 'Authorized' : 'Unauthorized';
          logger.debug(logSystem, logComponent, logSubCat, `${authString} ${addrPrimary}:${password} [${ip}:${port}]`);
          callback({ error: null, authorized: primaryAuthorized, disconnect: false });
        });
      } else {
        // If aux not authorized, we might still allow primary? Usually if aux is required, we fail.
        // But for safety, we log and fail if aux is enabled and not authorized.
        if (_this.poolConfig.auxiliary && _this.poolConfig.auxiliary.enabled) {
          logger.debug(logSystem, logComponent, logSubCat, `Unauthorized auxiliary address ${addrAuxiliary} [${ip}:${port}]`);
          callback({ error: null, authorized: false, disconnect: false });
        } else {
          // If aux not required, treat as authorized (solo mining)
          logger.debug(logSystem, logComponent, logSubCat, `Authorized (no aux) ${addrPrimary}:${password} [${ip}:${port}]`);
          callback({ error: null, authorized: true, disconnect: false });
        }
      }
    });
  };

  // Handle Share Submissions (unchanged)
  /* istanbul ignore next */
  this.handleShares = function(shareData, shareType, blockValid, callback) {
    _this.poolShares.handleShares(shareData, shareType, blockValid, () => {
      _this.checkPrimary(shareData, blockValid);
      _this.checkAuxiliary(shareData, blockValid);
      _this.checkShare(shareData, shareType);
      callback();
    }, () => {});
  };

  // Handle Stratum Events (unchanged)
  this.handleEvents = function(poolStratum) {
    poolStratum.on('banIP', (ip) => {
      _this.poolStratum.stratum.addBannedIP(ip);
    });
    poolStratum.on('log', (severity, text) => {
      logger[severity](logSystem, logComponent, logSubCat, text);
    });
    poolStratum.on('difficultyUpdate', (workerName, diff) => {
      logger.debug(logSystem, logComponent, logSubCat, `Difficulty update to ${ diff } for worker: ${ JSON.stringify(workerName) }`);
    });
    poolStratum.on('share', (shareData, shareType, blockValid, callback) => {
      _this.handleShares(shareData, shareType, blockValid, callback);
    });
    return poolStratum;
  };

  // Handle Stratum Statistics (unchanged)
  /* istanbul ignore next */
  this.handleStatistics = function(poolStratum) {
    if (_this.forkId === '0') {
      _this.poolStatistics.setupStatistics(poolStratum);
    }
  };

  // Build Pool from Configuration
  this.setupStratum = function(callback) {
    let poolStratum = Stratum.create(_this.poolConfig, _this.portalConfig, _this.authorizeWorker, callback);
    poolStratum = _this.handleEvents(poolStratum);
    poolStratum.setupPool();
    _this.handleStatistics(poolStratum);
    this.poolStratum = poolStratum;
  };
};

module.exports = PoolStratum;
