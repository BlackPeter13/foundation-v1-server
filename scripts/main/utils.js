/*
 *
 * Utils (Updated) – optimized for high load
 *
 */

const os = require('os');
const crypto = require('crypto');

// Precompile regex for performance
const regexFloat = /^-?\d*(\.\d+)?$/;

////////////////////////////////////////////////////////////////////////////////

// Calculate Average of Object Property (optimized)
exports.calculateAverage = function(data, property) {
  if (!data || data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i][property] || 0;
  }
  const avg = sum / data.length;
  return Math.round(avg * 100) / 100;
};

// Check if Value is a Number
exports.checkNumber = function(value) {
  if (typeof value !== 'string') return false;
  return !isNaN(value) && !isNaN(parseFloat(value));
};

// Check to see if Solo Mining
exports.checkSoloMining = function(poolConfig, data) {
  const activePort = poolConfig.ports.filter(port => port.port === data.port);
  return activePort.length >= 1 && activePort[0].type === 'solo';
};

// Round Coins to Nearest Value
exports.coinsRound = function(number, precision) {
  return exports.roundTo(number, precision);
};

// Convert Coins to Satoshis
exports.coinsToSatoshis = function(coins, magnitude) {
  return Math.round(coins * magnitude);
};

// Combine Solo/Shared Miners Count
exports.combineMiners = function(shared, solo) {
  let output = 0;
  if (shared) output += exports.countMiners(shared.map(s => safeJSONParse(s)));
  if (solo) output += exports.countMiners(solo.map(s => safeJSONParse(s)));
  return output;
};

// Count Number of Miners (optimized)
exports.countMiners = function(shares) {
  if (!shares || shares.length === 0) return 0;
  const miners = new Set();
  for (let i = 0; i < shares.length; i++) {
    const share = shares[i];
    if (share && share.worker) {
      miners.add(share.worker.split('.')[0]);
    }
  }
  return miners.size;
};

// Count Occurences of Value in Array
exports.countOccurences = function(array, value) {
  let count = 0;
  for (let i = 0; i < array.length; i++) {
    if (array[i] === value) count++;
  }
  return count;
};

// Combine Solo/Shared Workers Count
exports.combineWorkers = function(shared, solo) {
  let output = 0;
  if (shared) output += exports.countWorkers(shared.map(s => safeJSONParse(s)));
  if (solo) output += exports.countWorkers(solo.map(s => safeJSONParse(s)));
  return output;
};

// Count Number of Workers
exports.countWorkers = function(shares) {
  if (!shares || shares.length === 0) return 0;
  const workers = new Set();
  for (let i = 0; i < shares.length; i++) {
    const share = shares[i];
    if (share && share.worker) {
      workers.add(share.worker);
    }
  }
  return workers.size;
};

// Count Number of Process Forks
exports.countProcessForks = function(portalConfig) {
  if (!portalConfig.clustering || !portalConfig.clustering.enabled) return 1;
  if (portalConfig.clustering.forks === 'auto') {
    const cpus = os.cpus().length;
    return cpus >= 4 ? 4 : cpus;
  }
  const forks = parseInt(portalConfig.clustering.forks, 10);
  return isNaN(forks) ? 1 : forks;
};

// Generate Unique ExtraNonce
exports.extraNonceCounter = function(size) {
  return {
    size: size,
    next: function() {
      return crypto.randomBytes(this.size).toString('hex');
    }
  };
};

// List Blocks per Address
exports.listBlocks = function(blocks, address) {
  if (!blocks || blocks.length === 0) return [];
  const output = [];
  const parsed = blocks.map(b => safeJSONParse(b)).filter(b => b);
  parsed.sort((a, b) => (b.height || 0) - (a.height || 0));
  for (let i = 0; i < parsed.length; i++) {
    const block = parsed[i];
    if (block.worker && block.worker.split('.')[0] === address) {
      output.push(block);
    }
  }
  return output;
};

// List Share Identifiers
exports.listIdentifiers = function(shares) {
  if (!shares || shares.length === 0) return [''];
  const identifiers = new Set();
  for (let i = 0; i < shares.length; i++) {
    const share = safeJSONParse(shares[i]);
    if (share && share.identifier !== undefined) {
      identifiers.add(share.identifier);
    }
  }
  if (identifiers.size === 0) return [''];
  return Array.from(identifiers);
};

// List Round Workers for API Endpoints
exports.listWorkers = function(shares, address) {
  if (!shares) return [];
  const workers = new Set();
  const keys = Object.keys(shares);
  for (let i = 0; i < keys.length; i++) {
    const entry = keys[i];
    const details = safeJSONParse(shares[entry]);
    if (!details || !details.worker) continue;
    const worker = (address && address.includes('.')) ? entry : entry.split('.')[0];
    if (!address || address === worker) {
      workers.add(details.worker);
    }
  }
  return Array.from(workers);
};

// Indicate Severity By Colors (unchanged)
exports.loggerColors = function(severity, text) {
  switch (severity) {
    case 'debug': return text.green;
    case 'warning': return text.yellow;
    case 'error': return text.red;
    case 'special': return text.cyan;
    default: return text.italic;
  }
};

// Severity Mapping Values
exports.loggerSeverity = {
  'debug': 1,
  'warning': 2,
  'error': 3,
  'special': 4
};

// Process Blocks (optimized)
exports.processBlocks = function(blocks) {
  if (!blocks || blocks.length === 0) return [];
  const output = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = safeJSONParse(blocks[i]);
    if (block) {
      if (block.worker) block.worker = block.worker.split('.')[0];
      output.push(block);
    }
  }
  output.sort((a, b) => (b.height || 0) - (a.height || 0));
  return output;
};

// Process Historical Data
exports.processHistorical = function(history) {
  if (!history || history.length === 0) return [];
  const output = [];
  for (let i = 0; i < history.length; i++) {
    const entry = safeJSONParse(history[i]);
    if (entry) output.push(entry);
  }
  return output;
};

// Process Work with Identifier (unchanged, but uses compiled regex)
exports.processIdentifiers = function(shares, multiplier, hashrateWindow) {
  if (!shares) return [];
  const identifiers = exports.listIdentifiers(shares);
  const output = [];
  for (let i = 0; i < identifiers.length; i++) {
    const id = identifiers[i];
    const hashrateValue = exports.processWork(shares, null, null, id);
    output.push({
      identifier: id,
      hashrate: (multiplier * hashrateValue) / hashrateWindow
    });
  }
  return output;
};

// Process Luck (optimized)
exports.processLuck = function(pending, confirmed) {
  const combined = [];
  if (pending) {
    for (let i = 0; i < pending.length; i++) {
      const b = safeJSONParse(pending[i]);
      if (b) combined.push(b);
    }
  }
  if (confirmed) {
    for (let i = 0; i < confirmed.length; i++) {
      const b = safeJSONParse(confirmed[i]);
      if (b) combined.push(b);
    }
  }
  combined.sort((a, b) => (b.height || 0) - (a.height || 0));
  return {
    luck1: exports.calculateAverage(combined.slice(0, 1), 'luck'),
    luck10: exports.calculateAverage(combined.slice(0, 10), 'luck'),
    luck100: exports.calculateAverage(combined.slice(0, 100), 'luck')
  };
};

// Process Miners (optimized – single pass)
exports.processMiners = function(shares, hashrate, multiplier, hashrateWindow, active) {
  if (!shares) return [];
  const miners = {};
  const hashrateMap = buildHashrateMap(hashrate, 'miner');

  const keys = Object.keys(shares);
  for (let i = 0; i < keys.length; i++) {
    const entry = keys[i];
    const details = safeJSONParse(shares[entry]);
    if (!details || !details.worker) continue;

    const address = entry.split('.')[0];
    const workValue = parseFloat(details.work) || 0;
    if (workValue <= 0) continue;

    const hashrateValue = hashrateMap[address] || 0;
    if (active && hashrateValue === 0) continue;

    const effortValue = parseFloat(details.effort) || 0;
    const timeValue = parseFloat(details.times) || 0;

    if (!miners[address]) {
      miners[address] = {
        time: details.time || 0,
        miner: address,
        effort: details.solo ? effortValue : null,
        hashrate: (multiplier * hashrateValue) / hashrateWindow,
        shares: { valid: 0, invalid: 0, stale: 0 },
        times: !details.solo ? timeValue : null,
        work: 0,
      };
    }

    const miner = miners[address];
    // Update time (keep latest)
    if (details.time && details.time > miner.time) miner.time = details.time;
    // Solo effort accumulates
    if (details.solo && effortValue) miner.effort = (miner.effort || 0) + effortValue;
    // Times – keep max
    if (!details.solo && timeValue > miner.times) miner.times = timeValue;
    // Shares
    const types = details.types || {};
    miner.shares.valid += types.valid || 0;
    miner.shares.invalid += types.invalid || 0;
    miner.shares.stale += types.stale || 0;
    // Work
    miner.work += workValue;
  }

  return Object.values(miners);
};

// Process Payments
exports.processPayments = function(payments, address) {
  if (!payments) return {};
  const output = {};
  const keys = Object.keys(payments);
  for (let i = 0; i < keys.length; i++) {
    const worker = keys[i];
    const val = parseFloat(payments[worker]);
    if (val > 0 && (!address || address === worker)) {
      output[worker] = val;
    }
  }
  return output;
};

// Process Records
exports.processRecords = function(records) {
  if (!records || records.length === 0) return [];
  const output = [];
  for (let i = 0; i < records.length; i++) {
    const rec = safeJSONParse(records[i]);
    if (rec) output.push(rec);
  }
  output.sort((a, b) => (b.time || 0) - (a.time || 0));
  return output;
};

// Process Shares (optimized)
exports.processShares = function(shares, address, type) {
  if (!shares) return {};
  const output = {};
  const keys = Object.keys(shares);
  for (let i = 0; i < keys.length; i++) {
    const entry = keys[i];
    const details = safeJSONParse(shares[entry]);
    if (!details || !details.worker) continue;
    const worker = type === 'worker' ? entry : entry.split('.')[0];
    if (address && address !== worker) continue;
    const workValue = parseFloat(details.work) || 0;
    if (workValue <= 0) continue;
    output[worker] = (output[worker] || 0) + workValue;
  }
  return output;
};

// Process Times (optimized)
exports.processTimes = function(shares, address, type) {
  if (!shares) return {};
  const output = {};
  const keys = Object.keys(shares);
  for (let i = 0; i < keys.length; i++) {
    const entry = keys[i];
    const details = safeJSONParse(shares[entry]);
    if (!details || details.solo) continue;
    const worker = type === 'worker' ? entry : entry.split('.')[0];
    if (address && address !== worker) continue;
    const timeValue = parseFloat(details.times) || 0;
    if (timeValue <= 0) continue;
    if (!output[worker] || timeValue > output[worker]) {
      output[worker] = timeValue;
    }
  }
  return output;
};

// Process Types (optimized)
exports.processTypes = function(shares, address, type) {
  if (!shares) return {};
  const output = {};
  const keys = Object.keys(shares);
  for (let i = 0; i < keys.length; i++) {
    const entry = keys[i];
    const details = safeJSONParse(shares[entry]);
    if (!details || !details.worker) continue;
    const worker = type === 'worker' ? entry : entry.split('.')[0];
    if (address && address !== worker) continue;
    const types = details.types || {};
    if (!output[worker]) {
      output[worker] = { valid: 0, invalid: 0, stale: 0 };
    }
    output[worker].valid += types.valid || 0;
    output[worker].invalid += types.invalid || 0;
    output[worker].stale += types.stale || 0;
  }
  return output;
};

// Process Work (optimized)
exports.processWork = function(shares, address, type, identifier) {
  if (!shares || shares.length === 0) return 0;
  let output = 0;
  for (let i = 0; i < shares.length; i++) {
    const share = safeJSONParse(shares[i]);
    if (!share || !share.worker || !share.work) continue;
    if (identifier !== undefined && identifier !== '' && share.identifier !== identifier) continue;
    const workVal = parseFloat(share.work) || 0;
    if (workVal === 0) continue;
    if (!address) {
      output += workVal;
    } else if (type === 'miner') {
      const workerAddr = share.worker.split('.')[0];
      if (workerAddr === address) output += workVal;
    } else if (type === 'worker') {
      if (share.worker === address) output += workVal;
    } else {
      // fallback: match by share.worker exactly
      if (share.worker === address) output += workVal;
    }
  }
  return output;
};

// Process Workers (optimized – single pass)
exports.processWorkers = function(shares, hashrate, multiplier, hashrateWindow, active) {
  if (!shares) return [];
  const workers = {};
  const hashrateMap = buildHashrateMap(hashrate, 'worker');

  const keys = Object.keys(shares);
  for (let i = 0; i < keys.length; i++) {
    const entry = keys[i];
    const details = safeJSONParse(shares[entry]);
    if (!details || !details.worker) continue;

    const workValue = parseFloat(details.work) || 0;
    if (workValue <= 0) continue;

    const hashrateValue = hashrateMap[entry] || 0;
    if (active && hashrateValue === 0) continue;

    const effortValue = parseFloat(details.effort) || 0;
    const timeValue = parseFloat(details.times) || 0;

    workers[entry] = {
      time: details.time || 0,
      worker: entry,
      effort: details.solo ? effortValue : null,
      hashrate: (multiplier * hashrateValue) / hashrateWindow,
      shares: {
        valid: (details.types || {}).valid || 0,
        invalid: (details.types || {}).invalid || 0,
        stale: (details.types || {}).stale || 0,
      },
      times: !details.solo ? timeValue : null,
      work: workValue,
    };
  }

  return Object.values(workers);
};

// Round to # of Digits Given
exports.roundTo = function(n, digits) {
  if (digits === undefined || digits === null) digits = 0;
  const multiplicator = Math.pow(10, digits);
  n = parseFloat((n * multiplicator).toFixed(11));
  return Math.round(n) / multiplicator;
};

// Convert Satoshis to Coins
exports.satoshisToCoins = function(satoshis, magnitude, precision) {
  return exports.roundTo((satoshis / magnitude), precision);
};

// Validate Entered Address
exports.validateInput = function(address) {
  if (address && address.length >= 1) {
    return address.toString().replace(/[^a-zA-Z0-9.-]+/g, '');
  }
  return '';
};

// ==================== HELPERS ====================

// Safe JSON parse – returns null on failure
function safeJSONParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

// Build a hashmap of address => hashrate from an array of hashrate entries
// Used by processMiners and processWorkers to avoid O(n²)
function buildHashrateMap(hashrate, type) {
  const map = {};
  if (!hashrate || hashrate.length === 0) return map;
  for (let i = 0; i < hashrate.length; i++) {
    const entry = safeJSONParse(hashrate[i]);
    if (!entry || !entry.worker) continue;
    const key = type === 'miner' ? entry.worker.split('.')[0] : entry.worker;
    const workVal = parseFloat(entry.work) || 0;
    if (workVal > 0) {
      map[key] = (map[key] || 0) + workVal;
    }
  }
  return map;
}
