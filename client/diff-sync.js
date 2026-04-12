/**
 * Link the viewboxes of two bpmn-js viewers so that panning/zooming one
 * mirrors the other in real time.
 *
 * Why the `locked` guard is necessary:
 *   canvas.viewbox(v) applies the new viewbox AND fires 'canvas.viewbox.changed'
 *   *synchronously* before it returns. Without the guard the two handlers would
 *   call each other in an infinite loop within a single stack frame.
 *
 * @param {*} vA  Left bpmn-js NavigatedViewer.
 * @param {*} vB  Right bpmn-js NavigatedViewer.
 * @returns {{ unbind: function(): void }}  Call unbind() to stop synchronisation.
 */
export function startSync(vA, vB) {
    const cA = vA.get('canvas');
    const cB = vB.get('canvas');
    const bA = vA.get('eventBus');
    const bB = vB.get('eventBus');
    let locked = false;

    function onA(e) {
        if (locked) return;
        locked = true;
        cB.viewbox(e.viewbox);
        locked = false;
    }

    function onB(e) {
        if (locked) return;
        locked = true;
        cA.viewbox(e.viewbox);
        locked = false;
    }

    bA.on('canvas.viewbox.changed', onA);
    bB.on('canvas.viewbox.changed', onB);

    return {
        unbind: function () {
            bA.off('canvas.viewbox.changed', onA);
            bB.off('canvas.viewbox.changed', onB);
        }
    };
}
