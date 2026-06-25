/*
 *
 * Database (Updated) – with retry strategy & async version check
 *
 */

const fs = require('fs');
const path = require('path');
const redis = require('redis');
const { promisify } = require('util');

////////////////////////////////////////////////////////////////////////////////

// Main Database Function
const PoolDatabase = function(portalConfig) {

  const _this = this;
  this.portalConfig = portalConfig;

  // Connect to Redis Client
  /* istanbul ignore next */
  this.buildRedisClient = function() {

    // Build Connection Options
    const connectionOptions = {};
    connectionOptions.port = _this.portalConfig.redis.port;
    connectionOptions.host = _this.portalConfig.redis.host;

    // Check if Authentication is Set
    if (_this.portalConfig.redis.password !== '') {
      connectionOptions.password = _this.portalConfig.redis.password;
    }

    // Check if TLS Configuration is Set
    if (_this.portalConfig.redis.tls) {
      connectionOptions.tls = {};
      connectionOptions.tls.key = fs.readFileSync(path.join('./certificates', _this.portalConfig.tls.key));
      connectionOptions.tls.cert = fs.readFileSync(path.join('./certificates', _this.portalConfig.tls.cert));
      connectionOptions.tls.ca = fs.readFileSync(path.join('./certificates', _this.portalConfig.tls.ca));
    }

    // Add retry strategy to handle connection drops under load
    connectionOptions.retry_strategy = function(options) {
      if (options.error && options.error.code === 'ECONNREFUSED') {
        // End reconnecting on a specific error and flush all commands with an error
        return new Error('The server refused the connection');
      }
      if (options.total_retry_time > 1000 * 60 * 60) {
        // End reconnecting after a specific timeout and flush all commands with an error
        return new Error('Retry time exhausted');
      }
      if (options.attempt > 10) {
        // End reconnecting with built in error
        return undefined;
      }
      // Reconnect after a random delay (100–300ms) to avoid thundering herd
      return Math.min(options.attempt * 50, 300);
    };

    // Set a connection timeout (in ms)
    connectionOptions.connect_timeout = 10000; // 10 seconds

    // Enable ready check to verify Redis is ready
    connectionOptions.enable_ready_check = true;

    // Disable offline queue if you want to fail fast, but keep it enabled for resilience
    connectionOptions.enable_offline_queue = true;

    return redis.createClient(connectionOptions);
  };

  // Check Redis Client Version – now async/non‑blocking
  this.checkRedisClient = async function(client) {
    try {
      const infoAsync = promisify(client.info).bind(client);
      const response = await infoAsync();
      let version;
      const settings = response.split('\r\n');
      settings.forEach(line => {
        if (line.indexOf('redis_version') !== -1) {
          version = parseFloat(line.split(':')[1]);
        }
      });
      if (!version || version <= 2.6) {
        console.log('Could not detect redis version or your redis client is out of date');
      } else {
        console.log(`Connected to Redis v${version}`);
      }
    } catch (error) {
      console.log('Redis version check failed:', error.message);
    }
  };
};

module.exports = PoolDatabase;
