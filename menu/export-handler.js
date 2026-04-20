'use strict';

/**
 * @typedef {{ oldVal: string, newVal: string }} AttrChange
 * @typedef {{ id: string, name: string, type: string, attrs?: Object.<string, AttrChange> }} SerializedItem
 * @typedef {{ added: SerializedItem[], removed: SerializedItem[], changed: SerializedItem[], repositioned: SerializedItem[] }} SerializedDiff
 * @typedef {{ leftSvg: string, rightSvg: string, leftLabel: string, rightLabel: string, serialized: SerializedDiff, fileName?: string }} ExportData
 */

const {ipcMain} = require('electron');

// ─── IPC handler registration ─────────────────────────────────────────────────

/**
 * Register the export IPC handler.
 * Guarded against duplicate registration because Camunda Modeler may re-require
 * this module on each new file open.
 */
function registerExportHandler() {
    if (ipcMain.listenerCount('bpmn-diff:export') > 0) {
        return;
    }

    ipcMain.handle('bpmn-diff:export', async function (event, /** @type {ExportData} */ exportData) {
        const {dialog, BrowserWindow} = require('electron');
        const fs = require('fs');

        // Prefer the bare filename passed from the diff window (e.g. "order").
        // Fall back to a sanitised version of the display label.
        const defaultName = exportData.fileName
            || (exportData.leftLabel || 'bpmn-diff').replace(/[^a-zA-Z0-9_\-.]/g, '_');

        const {filePath, canceled} = await dialog.showSaveDialog({
            title: 'Export BPMN Diff',
            defaultPath: defaultName,
            filters: [
                {name: 'PDF Document', extensions: ['pdf']},
                {name: 'PNG Image', extensions: ['png']}
            ]
        });

        if (canceled || !filePath) {
            return {cancelled: true};
        }

        const isPng = filePath.toLowerCase().endsWith('.png');
        const html = buildExportHTML(exportData);

        // Render the HTML in a hidden off-screen window so we can capture it.
        // Styles are inlined in the HTML because the data: URL has no base URL,
        // so <link rel="stylesheet"> would fail to resolve.
        const win = new BrowserWindow({
            show: false,
            width: isPng ? 2400 : 1600,
            height: isPng ? 1800 : 1200,
            webPreferences: {nodeIntegration: false, contextIsolation: true}
        });

        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

        let outBuffer;
        if (isPng) {
            // Resize to actual content dimensions so capturePage() captures the full page,
            // not just the initial viewport (which clips wide/tall diagrams).
            const {cw, ch} = await win.webContents.executeJavaScript(
                '({ cw: document.documentElement.scrollWidth, ch: document.documentElement.scrollHeight })'
            );
            if (cw > 0 && ch > 0) {
                win.setSize(cw, ch);
            }
            const image = await win.webContents.capturePage();
            outBuffer = image.toPNG();
        } else {
            outBuffer = await win.webContents.printToPDF({
                landscape: true,
                pageSize: 'A3',
                printBackground: true
            });
        }

        win.close();
        fs.writeFileSync(filePath, outBuffer);
        return {filePath};
    });
}

// ─── Export HTML builder ──────────────────────────────────────────────────────

/**
 * Escape a string for safe insertion into HTML attributes and text content.
 * @param {*} str
 * @returns {string}
 */
function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Build the complete HTML document used for PDF/PNG capture.
 * @param {ExportData} data
 * @returns {string}
 */
function buildExportHTML(data) {
    const {leftSvg, rightSvg, leftLabel, rightLabel, serialized} = data;
    const {added, removed, changed, repositioned} = serialized;
    const total = added.length + removed.length + changed.length + repositioned.length;
    const date = new Date().toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'});

    const sectionsHtml =
        buildSection('Added', '#2d7a00', added) +
        buildSection('Removed', '#990000', removed) +
        buildSection('Modified', '#004499', changed) +
        buildSection('Repositioned', '#0075ff', repositioned);

    const noChanges = total === 0
        ? '<p class="no-changes">No differences were found between the two diagrams.</p>'
        : '';

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
        '<style>' + EXPORT_CSS + '</style></head><body>' +
        '<h1>BPMN Diff \u2014 ' + esc(leftLabel) + ' vs ' + esc(rightLabel) + '</h1>' +
        '<div class="meta">Exported ' + esc(date) + ' &nbsp;&bull;&nbsp; ' +
        esc(leftLabel) + ' (base) vs ' + esc(rightLabel) + ' (target)' +
        ' &nbsp;&bull;&nbsp; ' + total + ' change' + (total === 1 ? '' : 's') +
        '</div>' +
        '<div class="diagrams">' +
        '<div class="diagram"><div class="diagram-label">' + esc(leftLabel) + '</div>' + leftSvg + '</div>' +
        '<div class="diagram"><div class="diagram-label">' + esc(rightLabel) + '</div>' + rightSvg + '</div>' +
        '</div>' +
        '<h2>Changes (' + total + ')</h2>' +
        noChanges + sectionsHtml +
        '</body></html>';
}

/**
 * Build one change-category section (Added / Removed / Modified / Repositioned).
 * @param {string}           label
 * @param {string}           color  Hex colour for the dot.
 * @param {SerializedItem[]} items
 * @returns {string}
 */
function buildSection(label, color, items) {
    if (!items || items.length === 0) return '';

    const rows = items.map(function (item) {
        let attrRows = '';
        if (item.attrs) {
            Object.keys(item.attrs).forEach(function (prop) {
                const ch = item.attrs[prop];
                attrRows +=
                    `<tr class="attr-row">
                        <td></td>
                        <td colspan="2" class="attr-cell">
                            <span class="attr-prop">${esc(prop)}</span>: ` +
                    (ch.oldVal ? `<span class="attr-old">${esc(ch.oldVal)}</span> &rarr; ` : '') +
                    `<span class="attr-new">${esc(ch.newVal)}</span>
                        </td>
                    </tr>`;
            });
        }
        return '<tr>' +
            '<td class="item-name">' + esc(item.name || item.id) + '</td>' +
            '<td class="item-id">' + esc(item.id) + '</td>' +
            '<td class="item-type">' + esc(item.type) + '</td>' +
            '</tr>' + attrRows;
    }).join('');

    return '<div class="section">' +
        '<div class="section-hdr">' +
        '<span class="dot" style="background:' + color + '"></span>' +
        '<span class="section-label">' + esc(label) + '</span>' +
        '<span class="section-count">' + items.length + '</span>' +
        '</div>' +
        '<table><thead><tr><th>Name</th><th>ID</th><th>Type</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '</div>';
}

// Inline styles for the export document — see buildExportHTML for why they are inlined.
// language=css
const EXPORT_CSS =
    '*, *::before, *::after { box-sizing: border-box; }' +
    'body { margin: 0; padding: 20px 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12px; color: #1a1a1a; background: #fff; }' +
    'h1 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }' +
    '.meta { font-size: 11px; color: #888; margin-bottom: 14px; }' +
    '.diagrams { display: flex; gap: 12px; height: 52vh; margin-bottom: 16px; }' +
    '.diagram { flex: 1; display: flex; flex-direction: column; border: 1px solid #dde1e4; border-radius: 4px; overflow: hidden; }' +
    '.diagram-label { padding: 4px 10px; background: #eef1f5; border-bottom: 1px solid #dde1e4; font-size: 11px; font-weight: 600; color: #555; text-align: center; flex-shrink: 0; }' +
    '.diagram svg { flex: 1; width: 100%; height: 100%; }' +
    'h2 { font-size: 13px; font-weight: 600; margin: 0 0 10px; border-bottom: 1px solid #dde1e4; padding-bottom: 6px; }' +
    '.section { margin-bottom: 12px; }' +
    '.section-hdr { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }' +
    '.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }' +
    '.section-label { font-size: 11px; font-weight: 700; }' +
    '.section-count { font-size: 10px; background: #e4e8ec; border-radius: 8px; padding: 1px 6px; color: #555; }' +
    'table { width: 100%; border-collapse: collapse; font-size: 11px; }' +
    'thead th { text-align: left; padding: 3px 8px; background: #f4f6f8; border-bottom: 1px solid #dde1e4; font-weight: 600; color: #555; }' +
    'tbody tr:nth-child(even):not(.attr-row) { background: #fafbfc; }' +
    'td { padding: 3px 8px; vertical-align: top; }' +
    '.item-name { font-weight: 500; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
    '.item-id { color: #888; font-style: italic; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }' +
    '.item-type { color: #666; white-space: nowrap; }' +
    '.attr-row td { padding-top: 0; padding-bottom: 2px; }' +
    '.attr-cell { font-size: 10px; color: #666; }' +
    '.attr-prop { font-weight: 600; color: #444; }' +
    '.attr-old { color: #c62828; text-decoration: line-through; }' +
    '.attr-new { color: #2d6a00; }' +
    '.no-changes { color: #888; font-style: italic; font-size: 12px; margin: 0; }';

module.exports = {registerExportHandler};
