'use strict';

let app = null;
let isAppLoaded = false;
const lateLogs = [];

/**
 * Call this from menu.js once electronApp is available.
 * Flushes any logs that were queued before init().
 *
 * @param {object} electronApp
 */
function init(electronApp) {
    app = electronApp;
    isAppLoaded = true;
    for (const entry of lateLogs) {
        _emit(entry.message, entry.category);
    }
    lateLogs.length = 0;
}

function error(message) {
    log(message, 'error');
}
/**
 * Log a message to the Camunda Modeler Output panel.
 *
 * @param {string} message
 * @param {'info'|'warning'|'error'|string} [category='info']
 */
function log(message, category = 'info') {
    if (!isAppLoaded) {
        console.log('app is not loaded, queuing log:', message);
        lateLogs.push({ message, category });
        return;
    }
    _emit(message, category);
}

function _emit(message, category) {
    message = `Differ-Plugin: ${message}`
    app.emit('menu:action', 'log', {
        category,
        message,
        silent: true
    });
}

module.exports = { init, log, error };
