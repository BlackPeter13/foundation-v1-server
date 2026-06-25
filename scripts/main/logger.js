/*
 *
 * Logger (Updated) – early severity check, cleaner argument handling
 *
 */

const colors = require('colors');
const dateFormat = require('dateformat');
const utils = require('./utils');

////////////////////////////////////////////////////////////////////////////////

// Main Logger Function
const PoolLogger = function (portalConfig) {

  const _this = this;
  this.logLevel = utils.loggerSeverity[portalConfig.logger.logLevel] || 0;
  this.logColors = portalConfig.logger.logColors !== false; // default true

  // Start Logging Capabilities
  this.logText = function(severity, system, component, text, subcat) {
    // Quick exit – if severity is below configured level, skip everything
    if (utils.loggerSeverity[severity] < _this.logLevel) {
      return;
    }

    // Handle optional subcategory parameter (argument swapping)
    let finalText = text;
    let finalSubcat = subcat;
    // If subcat is provided but text seems like a subcat (old style), swap
    // Usually subcat is optional; keep it simple
    if (typeof subcat === 'string' && subcat.length > 0) {
      // subcat is set
    } else if (subcat === undefined && typeof text === 'string') {
      // no subcat, text is the message
    } else {
      // If subcat is not a string, treat it as part of text
      finalText = text + (subcat ? ' ' + JSON.stringify(subcat) : '');
      finalSubcat = undefined;
    }

    const timestamp = dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss');
    let entryDesc = `${timestamp} [${system}]\t`;

    // Handle Logging Colors
    if (_this.logColors) {
      entryDesc = utils.loggerColors(severity, entryDesc);
      let logString = entryDesc + (`[${component}] `).italic;
      if (finalSubcat) {
        logString += (`(${finalSubcat}) `).bold.grey;
      }
      logString += finalText.grey;
      console.log(logString);
    } else {
      let logString = `${entryDesc}[${component}] `;
      if (finalSubcat) {
        logString += `(${finalSubcat}) `;
      }
      logString += finalText;
      console.log(logString);
    }
  };

  // Dynamically create methods for each severity level
  Object.keys(utils.loggerSeverity).forEach((logType) => {
    _this[logType] = function() {
      const args = Array.prototype.slice.call(arguments, 0);
      args.unshift(logType);
      _this.logText.apply(this, args);
    };
  });
};

module.exports = PoolLogger;
