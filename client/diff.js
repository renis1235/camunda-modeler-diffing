// ─── Entry point for the diff BrowserWindow ───────────────────────────────────
// Webpack bundles this file (and its imports) into diff.bundle.js.
// Responsibilities here: IPC wiring, viewer lifecycle, drop-zone, UI helpers.
// Business logic lives in the imported modules.

import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import BpmnModdle from 'bpmn-moddle';
import { diff } from 'bpmn-js-differ';

import 'bpmn-js/dist/assets/bpmn-js.css';
import './styles/diff.css';

import { state, dom } from './diff-state.js';
import { startSync } from './diff-sync.js';
import { applyMarkers } from './diff-markers.js';
import { fillChangesPanel, clearChangesPanel } from './diff-panel.js';
import { exportDiff } from './diff-export.js';

const {ipcRenderer} = window.require('electron');

// ─── Changes panel: collapse / expand ────────────────────────────────────────

dom.changesToggle.addEventListener('click', function () {
    const isCollapsed = dom.changesPanel.classList.toggle('collapsed');
    dom.changesToggle.innerHTML = isCollapsed ? '&#9650;' : '&#9660;';
    dom.changesToggle.title = isCollapsed ? 'Show changes' : 'Hide changes';
});

// ─── IPC: receive base XML from menu.js ──────────────────────────────────────

ipcRenderer.on('bpmn-diff:init', function (event, data) {
    state.baseXML = data.baseXML;
    state.fileName = data.fileName || null;
    dom.leftLabel.textContent = data.baseName || 'Base';

    // When targetXML is provided (e.g. from "Compare with HEAD"), auto-load it
    // immediately after the left viewer finishes rendering.
    const onReady = data.targetXML
        ? function () {
            dom.rightHeader.textContent = data.targetName || 'Target';
            handleTargetXML(data.targetXML);
        }
        : null;

    initLeftViewer(onReady);
});

// ─── Viewer initialisation ────────────────────────────────────────────────────

/**
 * (Re-)create the left viewer with the current base XML.
 * @param {function|null} onReady  Called after the diagram has been imported.
 */
function initLeftViewer(onReady) {
    if (state.leftViewer) {
        state.leftViewer.destroy();
        state.leftViewer = null;
    }
    state.leftViewer = new NavigatedViewer({container: dom.leftCanvas});
    state.leftViewer.importXML(state.baseXML)
        .then(function () {
            state.leftViewer.get('canvas').zoom('fit-viewport');
            if (onReady) {
                onReady();
            }
        })
        .catch(function (err) {
            showError('Failed to load base BPMN: ' + (err.message || err));
        });
}

// ─── Drop zone / file input ───────────────────────────────────────────────────

dom.dropZone.addEventListener('click', function () {
    dom.fileInput.click();
});
dom.dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dom.dropZone.classList.add('drag-over');
});
dom.dropZone.addEventListener('dragleave', function () {
    dom.dropZone.classList.remove('drag-over');
});
dom.dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dom.dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
});

dom.fileInput.addEventListener('change', function (e) {
    if (e.target.files[0]) readFile(e.target.files[0]);
    dom.fileInput.value = '';
});

/**
 * Read a File object and pass its text content to handleTargetXML.
 * @param {File} file
 */
function readFile(file) {
    const reader = new FileReader();
    reader.onload = e => handleTargetXML(e.target.result);
    reader.onerror = () => showError('Could not read file.');
    reader.readAsText(file);
}

// ─── Target file handling ─────────────────────────────────────────────────────

/**
 * Parse and diff the target XML against the base, then render both viewers.
 * @param {string} xml  Raw XML content of the target .bpmn file.
 * @returns {Promise<void>}
 */
async function handleTargetXML(xml) {
    showLoading(true);
    showError(null);
    showLegend(false);
    showExport(false);
    clearChangesPanel();
    state.lastDiffResult = null;

    if (state.syncBinding) {
        state.syncBinding.unbind();
        state.syncBinding = null;
    }
    if (state.rightViewer) {
        state.rightViewer.destroy();
        state.rightViewer = null;
    }

    dom.dropZone.style.display = 'none';
    dom.rightCanvas.style.removeProperty('display');
    dom.rightHeader.textContent = 'Target';

    try {
        // Parse both XMLs into bpmn-moddle objects required by bpmn-js-differ.
        const moddle = new BpmnModdle();
        const [baseResult, targetResult] = await Promise.all([
            moddle.fromXML(state.baseXML),
            moddle.fromXML(xml)
        ]);

        state.lastDiffResult = diff(baseResult.rootElement, targetResult.rootElement);

        state.rightViewer = new NavigatedViewer({container: dom.rightCanvas});
        await state.rightViewer.importXML(xml);
        state.rightViewer.get('canvas').zoom('fit-viewport');

        applyMarkers(state.lastDiffResult);
        state.syncBinding = startSync(state.leftViewer, state.rightViewer);
        fillChangesPanel(state.lastDiffResult);
        showLegend(true);
        showExport(true);
    } catch (err) {
        showError(err.message || 'Failed to parse or diff BPMN files.');
        dom.rightCanvas.style.display = 'none';
        dom.dropZone.style.removeProperty('display');
        dom.rightHeader.textContent = 'Target \u2014 drop a .bpmn file';
    }

    showLoading(false);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

/** @param {boolean} visible */
function showLoading(visible) {
    dom.loadingBar.style.display = visible ? '' : 'none';
}

/** @param {boolean} visible */
function showLegend(visible) {
    dom.legend.style.display = visible ? '' : 'none';
}

/** @param {boolean} enabled */
function showExport(enabled) {
    dom.btnExport.disabled = !enabled;
    dom.btnExport.title = enabled ? 'Export as PDF or PNG' : 'Load a target file first';
}

/**
 * Show or hide the error banner.
 * @param {string|null} message  Pass null to dismiss the banner.
 */
function showError(message) {
    if (message) {
        dom.errorMsg.textContent = message;
        dom.errorBanner.style.display = '';
    } else {
        dom.errorBanner.style.display = 'none';
    }
}

// ─── Button wiring ────────────────────────────────────────────────────────────

document.getElementById('btn-close').addEventListener('click', () => window.close());
document.getElementById('btn-dismiss-error').addEventListener('click', () => showError(null));
dom.btnExport.addEventListener('click', exportDiff);
