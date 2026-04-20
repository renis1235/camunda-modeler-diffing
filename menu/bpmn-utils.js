'use strict';

const {log, error} = require("./log-utils");

// ─── Shared menu-process utilities ────────────────────────────────────────────

// ─── Diff window singleton ────────────────────────────────────────────────────
// Tracked so that:
//  (a) re-triggering a compare action closes the old window and opens a fresh one, and
//  (b) getMainWindow() can reliably identify the Camunda Modeler window by exclusion.

/** @type {Electron.BrowserWindow|null} */
let _currentDiffWin = null;

/**
 * Return the Camunda Modeler main window, excluding the current diff window.
 * Uses exclusion because `getAllWindows()` order is not guaranteed when multiple
 * windows are open.
 *
 * @param {typeof Electron.BrowserWindow} BrowserWindow
 * @returns {Electron.BrowserWindow|null}
 */
function getMainWindow(BrowserWindow) {
    const wins = BrowserWindow.getAllWindows();
    return wins.find(function (w) {
        return w !== _currentDiffWin;
    }) || null;
}

/**
 * Close any existing diff window and open a fresh one.
 * Tracks the new window in `_currentDiffWin` and clears the reference on close.
 *
 * @param {typeof Electron.BrowserWindow} BrowserWindow
 * @param {string}                        htmlPath  Absolute path to diff.html.
 * @param {string}                        title     Window title.
 * @returns {Electron.BrowserWindow}
 */
function openDiffWindow(BrowserWindow, htmlPath, title) {
    if (_currentDiffWin && !_currentDiffWin.isDestroyed()) {
        log('openDiffWindow: closing existing diff window', 'warning');
        _currentDiffWin.close();
    }

    log(`openDiffWindow: creating window — title: "${title}", htmlPath: ${htmlPath}`);
    const win = new BrowserWindow({
        width: 1400, height: 860, minWidth: 800, minHeight: 500,
        title,
        webPreferences: {nodeIntegration: true, contextIsolation: false}
    });

    win.on('closed', function () {
        // Only clear the singleton if this window is still the current one.
        // If openDiffWindow was called again before this async event fired,
        // _currentDiffWin already points to a newer window — don't overwrite it.
        if (_currentDiffWin === win) {
            _currentDiffWin = null;
            log('openDiffWindow: diff window closed, singleton cleared');
        }
    });

    _currentDiffWin = win;
    win.loadFile(htmlPath);
    return win;
}

/**
 * Probe the currently active .bpmn file path without showing a dialog.
 *
 * Attempts:
 *   1. DOM probe  — reads the `title` attribute of the active tab element in
 *                   the Camunda Modeler renderer. The active tab is the most
 *                   reliable source because it holds the absolute file path.
 *   2. Recent docs — picks the most recently opened .bpmn entry from
 *                   Electron's recent-documents list.
 *
 * Returns null when neither attempt succeeds (e.g. no file is open yet, or
 * the Modeler DOM changed structure). Callers can fall back to a file-open
 * dialog if a path is strictly required.
 *
 * @param {Electron.BrowserWindow} mainWin
 * @param {Electron.App}           electronApp
 * @returns {Promise<string|null>}  Absolute file path, or null.
 */
async function probeActiveFilePath(mainWin, electronApp) {
    // Attempt 1: read the title attribute of the active tab from the Modeler DOM.
    try {
        const fromDom = await mainWin.webContents.executeJavaScript(
            // language=javascript
            `(function () {
                // Prefer the active tab (Camunda Modeler marks it with tab--active).
                const active = document.querySelector('.tab--active');
                if (active) {
                    const candidates = [active].concat(Array.from(active.querySelectorAll('[title]')));
                    for (let k = 0; k < candidates.length; k++) {
                        const t = candidates[k].getAttribute('title');
                        if (t && /\\.bpmn$/i.test(t) && /[\\/\\\\]/.test(t)) return t;
                    }
                }
                // Fallback: first element with a .bpmn title (single-tab case).
                const els = document.querySelectorAll('[title]');
                for (let i = 0; i < els.length; i++) {
                    const t = els[i].getAttribute('title');
                    if (t && /\\.bpmn$/i.test(t) && /[\\/\\\\]/.test(t)) return t;
                }
                return null;
            })()`
        );
        if (fromDom) {
            log(`probeActiveFilePath: found via DOM probe: ${fromDom}`);
            return fromDom;
        }
        log('probeActiveFilePath: DOM probe returned null, falling back to recent docs', 'warning');
    } catch (e) { /* DOM probe failed — continue to next attempt */
        error(`probeActiveFilePath: DOM probe threw: ${e && e.message ? e.message : String(e)}`);
    }

    // Attempt 2: use the most recently opened .bpmn file from Electron's recent docs.
    const recentDocs = electronApp.getRecentDocuments ? electronApp.getRecentDocuments() : [];
    log(`probeActiveFilePath: recent docs (${recentDocs.length} total): ${recentDocs.join(', ') || '(none)'}`);
    const recentBpmn = recentDocs.filter(p => /\.bpmn$/i.test(p));
    const fromRecentDocs = recentBpmn.length > 0 ? recentBpmn[0] : null;
    if (fromRecentDocs) {
        log(`probeActiveFilePath: found via recent docs: ${fromRecentDocs}`);
    } else {
        log('probeActiveFilePath: no .bpmn file found in recent docs', 'warning');
    }
    return fromRecentDocs;
}

module.exports = {probeActiveFilePath, getMainWindow, openDiffWindow};
