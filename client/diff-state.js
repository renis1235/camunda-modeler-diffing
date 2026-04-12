// ─── Shared application state ─────────────────────────────────────────────────
// All modules import this object and mutate its properties directly.
// There is only ever one diff window, so a single shared object is appropriate.

/**
 * @typedef {{
 *   _added:         Object.<string, *>,
 *   _removed:       Object.<string, *>,
 *   _changed:       Object.<string, { model: *, attrs: Object.<string, { oldVal: *, newVal: * }> }>,
 *   _layoutChanged: Object.<string, *>
 * }} DiffResult
 */

/** Mutable runtime state shared across all diff modules. Reset on each new comparison. */
export const state = {
    /** @type {string|null} XML of the base (left) diagram. */
    baseXML: null,

    /** @type {*|null} Left bpmn-js NavigatedViewer instance (base diagram). */
    leftViewer: null,

    /** @type {*|null} Right bpmn-js NavigatedViewer instance (target diagram). */
    rightViewer: null,

    /** @type {{ unbind: function(): void }|null} Active viewbox-sync binding. */
    syncBinding: null,

    /** @type {HTMLElement|null} Currently highlighted change-list item element. */
    activeItem: null,

    /** @type {string|null} BPMN element ID of the selected item (for marker cleanup). */
    activeId: null,

    /** @type {DiffResult|null} Last computed diff result — kept in scope for export. */
    lastDiffResult: null,

    /** @type {string|null} Bare filename without extension (e.g. "order"), used as export default name. */
    fileName: null,
};

/** Cached DOM element references — queried once at module load time. */
export const dom = {
    leftLabel:          /** @type {HTMLElement}      */ (document.getElementById('left-label')),
    rightHeader:        /** @type {HTMLElement}      */ (document.getElementById('right-header')),
    leftCanvas:         /** @type {HTMLElement}      */ (document.getElementById('left-canvas')),
    rightCanvas:        /** @type {HTMLElement}      */ (document.getElementById('right-canvas')),
    dropZone:           /** @type {HTMLElement}      */ (document.getElementById('drop-zone')),
    fileInput:          /** @type {HTMLInputElement} */ (document.getElementById('file-input')),
    loadingBar:         /** @type {HTMLElement}      */ (document.getElementById('loading')),
    legend:             /** @type {HTMLElement}      */ (document.getElementById('legend')),
    errorBanner:        /** @type {HTMLElement}      */ (document.getElementById('error-banner')),
    errorMsg:           /** @type {HTMLElement}      */ (document.getElementById('error-msg')),
    changesPanel:       /** @type {HTMLElement}      */ (document.getElementById('changes-panel')),
    changesToggle:      /** @type {HTMLElement}      */ (document.getElementById('changes-toggle')),
    changesTitle:       /** @type {HTMLElement}      */ (document.getElementById('changes-title')),
    changesSections:    /** @type {HTMLElement}      */ (document.getElementById('changes-sections')),
    changesPlaceholder: /** @type {HTMLElement}      */ (document.getElementById('changes-placeholder')),
    btnExport:          /** @type {HTMLButtonElement}*/ (document.getElementById('btn-export')),
};
