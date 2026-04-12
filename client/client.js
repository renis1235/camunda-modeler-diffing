import {registerBpmnJSPlugin} from 'camunda-modeler-plugin-helpers';

// Track the most recently active bpmn-js instance across tabs.
// Each bpmn tab creates its own bpmn-js instance; we update _activeBpmnJS on
// any interaction so that the menu action reads from the correct tab.
let _activeBpmnJS = null;

function DiffXmlBridge(bpmnjs, eventBus) {
    _activeBpmnJS = bpmnjs;

    // Re-confirm the active instance on several events.
    // Camunda Modeler creates a brand-new bpmn-js instance for every tab, so
    // _activeBpmnJS must be updated whenever the user switches tabs or interacts
    // with a diagram.  We register on four events because there is no single
    // reliable "tab became visible" event:
    //   import.done         — a new diagram has just been loaded into this instance
    //   attach              — the canvas DOM node was (re-)attached (tab switch)
    //   canvas.viewbox.changed — the user panned/zoomed (covers most interactions)
    //   element.click       — belt-and-suspenders for click-only interactions
    eventBus.on('import.done', function () {
        _activeBpmnJS = bpmnjs;
    });
    eventBus.on('attach', function () {
        _activeBpmnJS = bpmnjs;
    });
    eventBus.on('canvas.viewbox.changed', function () {
        _activeBpmnJS = bpmnjs;
    });
    eventBus.on('element.click', function () {
        _activeBpmnJS = bpmnjs;
    });
}

DiffXmlBridge.$inject = ['bpmnjs', 'eventBus'];

// Exposed for menu.js via webContents.executeJavaScript(...)
window.__bpmnDiffGetXML = function () {
    if (!_activeBpmnJS) {
        return Promise.resolve(null);
    }
    return _activeBpmnJS.saveXML({format: true})
        .then(function (result) {
            return {xml: result.xml};
        })
        .catch(function () {
            return null;
        });
};

registerBpmnJSPlugin({
    __init__: ['diffXmlBridge'],
    diffXmlBridge: ['type', DiffXmlBridge]
});
