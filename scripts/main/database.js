const fs = require('fs');
const path = require('path');
const redis = require('redis');

const PoolDatabase = function(portalConfig) {

  const _this = this;
  this.portalConfig = portalConfig;
  
  // Cache the client instance
  let cachedClient = null;

  this.buildRedisClient = function() {

    // 1. Return the existing client if already created
    if (cachedClient) {
      return cachedClient;
    }

    // Build Connection Options (unchanged)
    const connectionOptions = {};
    connectionOptions.port = _this.portalConfig.redis.port;
    connectionOptions.host = _this.portalConfig.redis.host;

    if (_this.portalConfig.redis.password !== '') {
      connectionOptions.password = _this.portalConfig.redis.password;
    }

    if (_this.portalConfig.redis.tls) {
      connectionOptions.tls = {};
      connectionOptions.tls.key = fs.readFileSync(path.join('./certificates', _this.portalConfig.tls.key));
      connectionOptions.tls.cert = fs.readFileSync(path.join('./certificates', _this.portalConfig.tls.cert));
      connectionOptions.tls.ca = fs.readFileSync(path.join('./certificates', _this.portalConfig.tls.ca));
    }

    const client = redis.createClient(connectionOptions);

    // 2. Attach the error listener HERE – only once per client
    client.on('error', (err) => {
      console.error('Redis Client Error:', err);
      // Add your custom error handling logic (e.g., process exit, retry, etc.)
    });

    // Optional: clear cache if the client dies, so a new one can be created later
    client.on('end', () => {
      cachedClient = null;
    });

    cachedClient = client;
    return client;
  };

  this.checkRedisClient = function(client) {
    // ... (unchanged, but note you can now pass the cached client)
  };
};

module.exports = PoolDatabase;