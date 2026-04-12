# BPMN Diff Plugin for Camunda Modeler

[![Camunda Modeler 5.x+](https://img.shields.io/badge/Camunda%20Modeler-5.x+-blue)](https://camunda.com/download/modeler/)
[![Camunda 7](https://img.shields.io/badge/Camunda%207-supported-green)](https://docs.camunda.io/)
[![Camunda 8](https://img.shields.io/badge/Camunda%208-supported-green)](https://docs.camunda.io/)
[![Latest Release](https://img.shields.io/github/v/release/renis1235/camunda-modeler-diffing)](https://github.com/renis1235/camunda-modeler-diffing/releases/latest)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Camunda Differ** A plugin that lets you compare two BPMN 2.0 diagrams side-by-side inside the Camunda Modeler. Changes
are highlighted with color-coded overlays and both canvases scroll and zoom in perfect sync.

---

## Features

- **Split-pane view** — Base (current tab) on the left, Target (your file) on the right
- **Color-coded diff** — Added (green), Removed (red), Modified (blue), Repositioned (blue)
- **Synchronized navigation** — scroll or zoom either pane and the other mirrors it instantly
- **File picker & drag-and-drop** — drop a `.bpmn` or `.xml` file onto the right pane to start the comparison
- **Git integration** — compare the current file against HEAD or Previous Revision via the Plugins menu
- **Export** — save the diff as PDF or PNG
- **View-only / static snapshot** — safe read-only mode, no changes are written back to your files

---

## Requirements

- [Camunda Modeler](https://camunda.com/download/modeler/) **5.x** or later

---

## Installation

### Option A — Download release (recommended)

No Node.js or build step required.

1. Go to the [latest release](https://github.com/renis1235/camunda-modeler-diffing/releases/latest).
2. Download the `zip` file.
3. Extract the zip and copy the folder into the Camunda Modeler plugins directory:

   | OS | Plugins directory |
         |---|---|
   | macOS | `~/Library/Application Support/camunda-modeler/plugins/` |
   | Windows | `%APPDATA%\camunda-modeler\plugins\` |
   | Linux | `~/.config/camunda-modeler/plugins/` |

4. **Restart** Camunda Modeler.

> The plugins folder may not exist yet — create it if needed.

### Option B — Build from source

Requires Node.js **18+** and npm.

```sh
git clone https://github.com/renis1235/camunda-modeler-diffing.git
cd camunda-modeler-diffing
npm install
npm run bundle
```

Then copy the folder to the plugins directory (see table above) and restart the Modeler.

---

## Usage

1. Open any BPMN file in the Camunda Modeler.
2. Use the application menu: **Plugins → Compare With…**
3. A separate diff window opens. The **left pane** shows your current file (Base).
4. Drop a second `.bpmn` file onto the **right pane**, or click it to browse.
5. The plugin parses both files, computes the diff, and highlights changes.

### Git compare

Use **Plugins → Git → Compare with HEAD** (or "Previous Revision") to diff the currently open file against its last
committed version. Git must track the file.

### Color legend

| Color | Meaning                                       | Where shown     |
|-------|-----------------------------------------------|-----------------|
| Green | Element added                                 | Right pane only |
| Red   | Element removed                               | Left pane only  |
| Blue  | Properties modified / Position / size changed | Both panes      |

### Navigation

Pan and zoom freely in either pane — the other pane mirrors your viewport in real time. Use the standard bpmn-js
controls:

- **Scroll wheel** — zoom in / out
- **Click + drag** — pan
- **Ctrl / Cmd + Shift + F** — fit diagram to viewport

---

## Technical notes

- **No React.** The plugin is entirely vanilla JS. `client.js` injects a tiny bpmn-js DI service (`DiffXmlBridge`) via
  `registerBpmnJSPlugin` (v5 API) to expose the active diagram's XML. The diff UI runs in a separate `BrowserWindow`
  with its own self-contained bundle.
- **Static snapshot.** The comparison is taken at the moment you click "Compare With…" (using the last-saved contents of
  the open tab). Live edits made after that are not reflected.

---

## Dependencies

| Package                          | Purpose                                       |
|----------------------------------|-----------------------------------------------|
| `bpmn-js`                        | Renders the BPMN diagrams (`NavigatedViewer`) |
| `bpmn-js-differ`                 | Semantic diff engine                          |
| `bpmn-moddle`                    | Parses BPMN 2.0 XML into model objects        |
| `camunda-modeler-plugin-helpers` | Plugin registration API                       |

---

## Development

```sh
git clone https://github.com/renis1235/camunda-modeler-diffing.git
cd camunda-modeler-diffing
npm install
npm run bundle:watch   # rebuilds on every file change
```

Copy (or symlink) the folder into the plugins directory, then restart the Modeler after each rebuild.

| Command                | Description                                     |
|------------------------|-------------------------------------------------|
| `npm run bundle`       | Production build (minified)                     |
| `npm run bundle:dev`   | Development build (readable, with source maps)  |
| `npm run bundle:watch` | Development build that rebuilds on file changes |

Output: `client/client.bundle.js`, `client/diff.bundle.js`

---

## License

MIT
