'use strict';

const path = require('path');

const babelRule = {
  test: /\.js$/,
  exclude: /node_modules/,
  use: {
    loader: 'babel-loader',
    options: {
      presets: [
        // Electron embeds Chromium, so targeting recent Chrome versions matches
        // the actual runtime and avoids unnecessary polyfills.
        ['@babel/preset-env', { targets: 'last 2 Chrome versions' }]
      ]
    }
  }
};

module.exports = [

  // ── Bundle 1: client.bundle.js ────────────────────────────────────────────
  // Tiny bundle loaded by Camunda Modeler (via index.js "script" field).
  // Registers a bpmn-js plugin that exposes window.__bpmnDiffGetXML so
  // that menu.js can read the active diagram's XML without any React.
  {
    entry: './client/client.js',
    output: {
      path: path.resolve(__dirname, 'client'),
      filename: 'client.bundle.js'
    },
    module: {
      rules: [babelRule]
    },
    resolve: {
      extensions: ['.js']
    }
  },

  // ── Bundle 2: diff.bundle.js ──────────────────────────────────────────────
  // Full self-contained bundle for the standalone BrowserWindow diff UI.
  // Includes bpmn-js NavigatedViewer, bpmn-js-differ, bpmn-moddle.
  // No React — plain vanilla JS + DOM.
  {
    entry: './client/diff.js',
    output: {
      path: path.resolve(__dirname, 'client'),
      filename: 'diff.bundle.js'
    },
    module: {
      rules: [
        babelRule,
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
        },
        {
          // bpmn-js ships font and image assets; inline them (base64) into the
          // bundle.  Inlining avoids asset-path resolution failures when the
          // bundle is loaded from the Electron plugin directory — there is no
          // web server to resolve relative URLs pointing to separate asset files.
          test: /\.(png|svg|jpg|gif|woff|woff2|eot|ttf)$/,
          type: 'asset/inline'
        }
      ]
    },
    resolve: {
      extensions: ['.js']
    },
    devtool: 'source-map'
  }

];
