'use strict';

const {registerExportHandler} = require('./export-handler');
const {compareWithGitRef, PREV_FILE_REVISION} = require('./git-compare');
const {probeActiveFilePath, getMainWindow, openDiffWindow} = require('./bpmn-utils');

// Register the export IPC handler once at module load.
// The function is idempotent and safe to call on every require().
registerExportHandler();

// ─── Plugin menu ──────────────────────────────────────────────────────────────

/**
 * Plugin menu definition (Camunda Modeler v5 plugin API).
 * Called by the Modeler to build the Plugins menu entries.
 *
 * @param {Electron.App}            electronApp
 * @param {{ bpmn: boolean }}       menuState  bpmn is true when a BPMN file is open.
 * @returns {Array}  Menu item descriptors.
 */
module.exports = function (electronApp, menuState) {
    return [
        {
            label: 'Compare With\u2026',
            enabled: function () {
                return menuState.bpmn;
            },
            action: function () {
                const {BrowserWindow, dialog} = require('electron');
                const path = require('path');

                const mainWin = getMainWindow(BrowserWindow);
                if (!mainWin) {
                    console.error('[bpmn-diff] no BrowserWindows found');
                    return;
                }

                (async function () {
                    // Get the base XML from the active diagram via the client bridge.
                    const result = await mainWin.webContents.executeJavaScript(
                        // language=javascript
                        'window.__bpmnDiffGetXML ? window.__bpmnDiffGetXML() : null'
                    );
                    if (!result || !result.xml) {
                        dialog.showErrorBox('BPMN Diff', 'No active BPMN diagram found.\nOpen a .bpmn file first.');
                        return;
                    }

                    // Probe the active file path to get a reliable display name and
                    // export filename. Falls back to 'Base' if the path cannot be determined.
                    const filePath = await probeActiveFilePath(mainWin, electronApp);
                    const baseName = filePath ? path.basename(filePath) : 'Base';
                    const fileName = baseName.replace(/\.[^.]+$/, '');

                    // Close any existing diff window and open a fresh one.
                    const htmlPath = path.join(__dirname, '..', 'client', 'diff.html');
                    const diffWin = openDiffWindow(BrowserWindow, htmlPath, `BPMN Diff \u2014 ${baseName}`);

                    // Send the base XML once the window has finished loading.
                    diffWin.webContents.once('did-finish-load', function () {
                        diffWin.webContents.send('bpmn-diff:init', {baseXML: result.xml, baseName, fileName});
                    });
                })().catch(function (err) {
                    console.error('[bpmn-diff] failed to get XML:', err);
                    dialog.showErrorBox('BPMN Diff', `Failed to read diagram: ${err.message || String(err)}`);
                });
            }
        },
        {
            label: 'Git',
            submenu: [
                {
                    label: 'Compare with HEAD',
                    click: function () {
                        const {BrowserWindow} = require('electron');
                        const mainWin = getMainWindow(BrowserWindow);
                        if (mainWin) {
                            compareWithGitRef(mainWin, electronApp, 'HEAD', 'HEAD');
                        }
                    }
                },
                {
                    label: 'Compare with Previous Revision',
                    click: function () {
                        const {BrowserWindow} = require('electron');
                        const mainWin = getMainWindow(BrowserWindow);
                        if (mainWin) {
                            compareWithGitRef(mainWin, electronApp, PREV_FILE_REVISION, 'prev revision');
                        }
                    }
                }
            ]
        }
    ];
};
