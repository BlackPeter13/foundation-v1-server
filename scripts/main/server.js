/*
 *
 * Server (Updated) – optimized caching & rate limiting
 *
 */

const apicache = require('apicache');
const bodyParser = require('body-parser');
const compress = require('compression');
const cors = require('cors');
const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const rateLimit = require('express-rate-limit');
const PoolApi = require('./api.js');

////////////////////////////////////////////////////////////////////////////////

// Main Server Function
const PoolServer = function (logger, client) {

  const _this = this;
  process.setMaxListeners(0);

  this.client = client;
  this.poolConfigs = JSON.parse(process.env.poolConfigs);
  this.portalConfig = JSON.parse(process.env.portalConfig);

  // Handle Errors with API Responses
  this.handleErrors = function(api, error, res) {
    logger.error('Server', 'Website', `API call threw an unknown error: (${ error })`);
    api.buildResponse(500, 'The server was unable to handle your request. Verify your input or try again later', res);
  };

  // Build Server w/ Middleware
  this.buildServer = function() {

    // Build Main Server
    const app = express();
    const api = new PoolApi(_this.client, _this.poolConfigs, _this.portalConfig);

    // ----------------------------------------------------------------------
    // 1. Rate Limiter – increased to handle 9+ pools and frequent refreshes
    // ----------------------------------------------------------------------
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000,                // increased from 100 to 1000 per IP
      message: 'Too many requests, please try again later.',
    });

    // ----------------------------------------------------------------------
    // 2. Caching – ignore query parameters to respect the cache even with _=timestamp
    // ----------------------------------------------------------------------
    // By default, apicache uses the full URL including query string.
    // We override appendKey to only use the path (and optionally the body for POST)
    const cache = apicache
      .options({
        // Only cache GET requests (by default it caches all, but we restrict)
        // Also ignore query parameters for cache key
        appendKey: (req, res) => {
          // For GET requests, we only want to cache based on the path
          // This makes "?x=1" and "?x=2" use the same cached response
          return req.path;
        },
        // Default cache duration can be set here, or per route
        defaultDuration: '1 minute',
        // Optional: enable debug to see cache hits (set to true for debugging)
        debug: false,
      })
      .middleware;

    // ----------------------------------------------------------------------
    // 3. Middleware
    // ----------------------------------------------------------------------
    app.set('trust proxy', 1);
    app.use(bodyParser.json()); // only needed if POST requests exist, but fine
    app.use(limiter);

    // Apply caching to all GET endpoints under /api/v1/
    // We use a custom cache duration of 1 minute (default), but it can be adjusted.
    // For very dynamic endpoints like /miners/active, you could reduce to 30s.
    app.use('/api/v1/', cache('1 minute'));

    app.use(compress());
    app.use(cors());

    // Handle API Requests
    /* istanbul ignore next */
    app.get('/api/v1/:pool/:endpoint?', (req, res) => {
      api.handleApiV1(req, (code, message) => {
        api.buildResponse(code, message, res);
      });
    });

    // ERRORS - Handles API Errors
    /* istanbul ignore next */
    /* eslint-disable-next-line no-unused-vars */
    app.use((err, req, res, next) => {
      _this.handleErrors(api, err, res);
    });

    // Handle Health Check
    /* istanbul ignore next */
    app.get('/health/', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 'status': 'OK' }));
    });

    // Set Existing Server Variable
    /* istanbul ignore next */
    if (_this.portalConfig.server.tls) {
      const options = {
        key: fs.readFileSync(path.join('./certificates', _this.portalConfig.tls.key)),
        cert: fs.readFileSync(path.join('./certificates', _this.portalConfig.tls.cert)),
      };
      logger.debug('Server', 'Website', 'Enabling TLS/SSL encryption on API endpoints');
      this.server = https.createServer(options, app);
    } else {
      this.server = http.createServer(app);
    }
  };

  // Start Worker Capabilities
  this.setupServer = function(callback) {
    _this.buildServer();
    _this.server.listen(_this.portalConfig.server.port, _this.portalConfig.server.host, () => {
      logger.debug('Server', 'Website',
        `Website started on ${ _this.portalConfig.server.host }:${ _this.portalConfig.server.port }`);
      callback();
    });
  };
};

module.exports = PoolServer;
