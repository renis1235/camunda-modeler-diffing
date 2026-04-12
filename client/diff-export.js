import { state, dom } from './diff-state.js';
import { getTypeLabel } from './diff-panel.js';

const {ipcRenderer} = window.require('electron');

/**
 * @typedef {{ id: string, name: string, type: string, attrs?: Object.<string, { oldVal: string, newVal: string }> }} SerializedItem
 * @typedef {{ added: SerializedItem[], removed: SerializedItem[], changed: SerializedItem[], repositioned: SerializedItem[] }} SerializedDiff
 * @typedef {{ leftSvg: string, rightSvg: string, leftLabel: string, rightLabel: string, serialized: SerializedDiff, fileName?: string }} ExportData
 */

// ─── Public export trigger ────────────────────────────────────────────────────

/**
 * Capture both SVGs, serialise the diff result, and send everything to the
 * main process via IPC to render as PDF or PNG.
 *
 * @returns {Promise<void>}
 */
export async function exportDiff() {
    if (!state.leftViewer || !state.rightViewer || !state.lastDiffResult) {
        return;
    }

    dom.btnExport.disabled = true;
    dom.btnExport.textContent = 'Exporting\u2026';

    try {
        const [{svg: rawLeft}, {svg: rawRight}] = await Promise.all([
            state.leftViewer.saveSVG(),
            state.rightViewer.saveSVG()
        ]);

        const css = buildDiffCSS();
        const exportData = {
            leftSvg: injectSvgStyle(rawLeft, css),
            rightSvg: injectSvgStyle(rawRight, css),
            leftLabel: dom.leftLabel.textContent,
            rightLabel: dom.rightHeader.textContent,
            serialized: serializeDiffResult(state.lastDiffResult),
            fileName: state.fileName || null
        };

        await ipcRenderer.invoke('bpmn-diff:export', exportData);
    } catch (err) {
        dom.errorMsg.textContent = 'Export failed: ' + (err.message || String(err));
        dom.errorBanner.style.display = '';
    } finally {
        dom.btnExport.disabled = false;
        dom.btnExport.innerHTML = '&#x1F4E4; Export&hellip;';
    }
}

// ─── SVG CSS injection ────────────────────────────────────────────────────────
// Marker styles must be embedded directly into the SVG for self-contained export.
//
// Two CSS selector families are required because bpmn-js renders shapes and
// connections differently:
//
//   Shapes:      `.djs-visual > :nth-child(1)`
//                bpmn-js places the fill rect/ellipse as the first child of the
//                .djs-visual group — that element must be targeted to set fill.
//
//   Connections: `path, polyline`
//                bpmn-js applies `stroke` as an *inline style* on these elements,
//                so the CSS rule must use !important to win the cascade.

/**
 * Build the minified diff marker CSS for SVG embedding.
 * @returns {string}
 */
function buildDiffCSS() {
    // language=css
    return [
        '.diff-added:not(.djs-connection) .djs-visual > :nth-child(1){fill:rgba(82,180,21,.35)!important;stroke:#2d7a00!important;stroke-width:2px!important}',
        '.diff-removed:not(.djs-connection) .djs-visual > :nth-child(1){fill:rgba(204,0,0,.30)!important;stroke:#990000!important;stroke-width:2px!important}',
        '.diff-changed:not(.djs-connection) .djs-visual > :nth-child(1),.diff-layout:not(.djs-connection) .djs-visual > :nth-child(1){fill:rgba(0,102,204,.25)!important;stroke:#004499!important;stroke-width:2px!important}',
        '.diff-added.djs-connection .djs-visual path,.diff-added.djs-connection .djs-visual polyline{stroke:#2d7a00!important;stroke-width:3px!important}',
        '.diff-removed.djs-connection .djs-visual path,.diff-removed.djs-connection .djs-visual polyline{stroke:#990000!important;stroke-width:3px!important}',
        '.diff-changed.djs-connection .djs-visual path,.diff-changed.djs-connection .djs-visual polyline,.diff-layout.djs-connection .djs-visual path,.diff-layout.djs-connection .djs-visual polyline{stroke:#004499!important;stroke-width:3px!important}',
    ].join('');
}

/**
 * Inject a <style> block into an SVG string so colours survive the export.
 *
 * @param {string} svg
 * @param {string} css
 * @returns {string}
 */
function injectSvgStyle(svg, css) {
    const styleTag = '<style>' + css + '</style>';
    if (svg.includes('<defs>')) {
        return svg.replace('<defs>', '<defs>' + styleTag);
    }
    // No <defs> block present — insert one right after the opening <svg ...> tag.
    return svg.replace(/(<svg[^>]*>)/, '$1<defs>' + styleTag + '</defs>');
}

// ─── Diff result serialisation ────────────────────────────────────────────────

/**
 * Convert the live diff result (containing bpmn-moddle objects) to a plain
 * JSON-safe structure for IPC transport.
 *
 * bpmn-js-differ uses two entry shapes:
 *   _changed entries:             { model: <element>, attrs: { prop: { oldVal, newVal } } }
 *   _added / _removed / _layout:  the bpmn-moddle element directly
 *
 * @param {import('./diff-state.js').DiffResult|null} diffResult
 * @returns {SerializedDiff}
 */
export function serializeDiffResult(diffResult) {
    if (!diffResult) {
        return {added: [], removed: [], changed: [], repositioned: []};
    }

    /**
     * Extract id / name / type from an entry.
     * @param {*}       entry
     * @param {boolean} isChanged  True for _changed entries (need to unwrap model).
     */
    function pickElement(entry, isChanged) {
        const el = isChanged ? (entry.model || entry) : entry;
        return {id: (el && el.id) || '', name: (el && el.name) || '', type: getTypeLabel(el)};
    }

    const added = Object.keys(diffResult._added || {}).map(id => Object.assign({id}, pickElement(diffResult._added[id], false)));
    const removed = Object.keys(diffResult._removed || {}).map(id => Object.assign({id}, pickElement(diffResult._removed[id], false)));
    const repositioned = Object.keys(diffResult._layoutChanged || {}).map(id => Object.assign({id}, pickElement(diffResult._layoutChanged[id], false)));

    const changed = Object.keys(diffResult._changed || {}).map(function (id) {
        const entry = diffResult._changed[id];
        const item = Object.assign({id}, pickElement(entry, true));
        item.attrs = {};
        if (entry.attrs) {
            Object.keys(entry.attrs).forEach(function (prop) {
                const ch = entry.attrs[prop];
                item.attrs[prop] = {
                    oldVal: ch.oldVal != null ? String(ch.oldVal) : '',
                    newVal: ch.newVal != null ? String(ch.newVal) : ''
                };
            });
        }
        return item;
    });

    return {added, removed, changed, repositioned};
}
