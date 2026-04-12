'use strict';

// Plugin manifest consumed by Camunda Modeler (v5 plugin API).
//   script — loaded once into the Modeler's renderer process; registers the
//            bpmn-js DI service that exposes window.__bpmnDiffGetXML.
//   menu   — Electron main-process module; returns the Plugins menu entries.
module.exports = {
  name: 'BPMN Diff',
  script: './client/client.bundle.js',
  menu: './menu/menu.js'
};
