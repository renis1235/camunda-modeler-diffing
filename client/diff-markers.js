import { state } from './diff-state.js';

/**
 * Apply CSS diff markers to both viewers based on the diff result.
 * Each marker class name maps to a colour defined in diff.css.
 *
 * Diff key → pane mapping:
 *   _removed        → left pane only  (element existed in base, gone in target)
 *   _added          → right pane only (element is new in target)
 *   _changed        → both panes      (element changed properties)
 *   _layoutChanged  → both panes      (element moved / resized)
 *
 * @param {import('./diff-state.js').DiffResult} diffResult
 */
export function applyMarkers(diffResult) {
    const lc = state.leftViewer.get('canvas');
    const lReg = state.leftViewer.get('elementRegistry');
    const rc = state.rightViewer.get('canvas');
    const rReg = state.rightViewer.get('elementRegistry');

    Object.keys(diffResult._removed || {}).forEach(id => {
        if (lReg.get(id)) lc.addMarker(id, 'diff-removed');
    });
    Object.keys(diffResult._added || {}).forEach(id => {
        if (rReg.get(id)) rc.addMarker(id, 'diff-added');
    });
    Object.keys(diffResult._changed || {}).forEach(id => {
        if (lReg.get(id)) lc.addMarker(id, 'diff-changed');
        if (rReg.get(id)) rc.addMarker(id, 'diff-changed');
    });
    Object.keys(diffResult._layoutChanged || {}).forEach(id => {
        if (lReg.get(id)) lc.addMarker(id, 'diff-layout');
        if (rReg.get(id)) rc.addMarker(id, 'diff-layout');
    });
}

/**
 * Scroll the left viewer to bring the element into view (sync mirrors to right).
 * Falls back to the right viewer for elements that only exist in the target (_added).
 *
 * @param {string} id  BPMN element ID.
 */
export function navigateToElement(id) {
    let scrolled = false;

    if (state.leftViewer) {
        try {
            const el = state.leftViewer.get('elementRegistry').get(id);
            if (el) {
                state.leftViewer.get('canvas').scrollToElement(el);
                scrolled = true;
            }
        } catch (_) {
        }
    }

    if (!scrolled && state.rightViewer) {
        try {
            const el = state.rightViewer.get('elementRegistry').get(id);
            if (el) state.rightViewer.get('canvas').scrollToElement(el);
        } catch (_) {
        }
    }
}

/**
 * Add the 'diff-selected' marker to `id` in both viewers so that diff.css
 * can draw a prominent highlight ring around the selected element.
 *
 * @param {string} id
 */
export function selectInDiagram(id) {
    [state.leftViewer, state.rightViewer].forEach(function (viewer) {
        if (!viewer) return;
        try {
            viewer.get('canvas').addMarker(id, 'diff-selected');
        } catch (_) {
        }
    });
}

/**
 * Remove the 'diff-selected' marker from the element tracked by state.activeId.
 */
export function clearDiagramSelection() {
    if (!state.activeId) return;
    [state.leftViewer, state.rightViewer].forEach(function (viewer) {
        if (!viewer) return;
        try {
            viewer.get('canvas').removeMarker(state.activeId, 'diff-selected');
        } catch (_) {
        }
    });
}
