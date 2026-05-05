'use strict';

const {promisify} = require('util');
const {exec} = require('child_process');
const fs = require('fs');
const path = require('path');
const {probeActiveFilePath, openDiffWindow} = require('./bpmn-utils');
const {log, error} = require('./log-utils');

const execAsync = promisify(exec);
const readFileAsync = promisify(fs.readFile);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sentinel value — pass as `ref` to compareWithGitRef to automatically resolve
 * the previous commit that touched this specific file (not a repo-wide HEAD~1).
 */
const PREV_FILE_REVISION = Symbol('PREV_FILE_REVISION');

/**
 * Open a diff window comparing the given git ref (base) against the current
 * working-tree version (target) of whichever .bpmn file is active.
 *
 * File resolution order:
 *   1. DOM probe  — reads the title attribute of the active tab in Camunda Modeler.
 *   2. Recent docs — picks the most recently opened .bpmn file.
 *   3. File-open dialog — last-resort fallback.
 *
 * @param {Electron.BrowserWindow} mainWin
 * @param {Electron.App}           electronApp
 * @param {string|symbol}          ref       Git ref (e.g. 'HEAD') or PREV_FILE_REVISION.
 * @param {string}                 refLabel  Human-readable label shown in the diff window title.
 * @returns {Promise<void>}
 */
async function compareWithGitRef(mainWin, electronApp, ref, refLabel) {
    const {dialog, BrowserWindow} = require('electron');

    log(`compareWithGitRef called — ref: ${String(ref)}, refLabel: ${refLabel}`);

    const filePath = await probeFilePath(mainWin, electronApp, dialog);
    if (!filePath) {
        log('compareWithGitRef: no file path resolved, aborting', 'warning');
        return; // e.g. user cancelled the picker
    }

    log(`compareWithGitRef: resolved file path: ${filePath}`);

    const fileName = path.basename(filePath);
    const dir = path.dirname(filePath);

    try {
        const relPath = await getTrackedRelPath(fileName, dir);
        const {resolvedRef, resolvedLabel} = await resolveGitRef(ref, refLabel, relPath, dir, fileName);
        log(`compareWithGitRef: resolved ref "${resolvedRef}", label "${resolvedLabel}"`);

        const {stdout: baseXML} = await readGitFileAtRef(resolvedRef, relPath, resolvedLabel, fileName, dir);
        log(`compareWithGitRef: base XML read, length: ${baseXML.length}`);

        const currentXML = await readFileAsync(filePath, 'utf8');
        log(`compareWithGitRef: current XML read, length: ${currentXML.length}`);

        launchDiffWindow(BrowserWindow, {baseXML, currentXML, fileName, resolvedLabel});
    } catch (err) {
        error(`compareWithGitRef failed: ${err.message || String(err)}`);
        dialog.showErrorBox('BPMN Diff', err.message || String(err));
    }
}

// ─── Step 1: resolve the file path ───────────────────────────────────────────

/**
 * Resolve the active .bpmn file path, falling back to a file-open dialog as a
 * last resort. Attempts 1 & 2 (DOM probe + recent docs) are delegated to the
 * shared `probeActiveFilePath` utility.
 *
 * @param {Electron.BrowserWindow} mainWin
 * @param {Electron.App}           electronApp
 * @param {Electron.Dialog}        dialog
 * @returns {Promise<string|null>}  Absolute file path, or null if the user cancelled.
 */
async function probeFilePath(mainWin, electronApp, dialog) {
    log('probeFilePath: probing active file path...');
    const filePath = await probeActiveFilePath(mainWin, electronApp);
    if (filePath) {
        log(`probeFilePath: found via probe: ${filePath}`);
        return filePath;
    }

    log('probeFilePath: probe returned null, opening file picker dialog', 'warning');
    // Attempt 3: ask the user to pick the file manually.
    const result = await dialog.showOpenDialog({
        title: 'Select the BPMN file to compare',
        filters: [{name: 'BPMN files', extensions: ['bpmn', 'xml']}],
        properties: ['openFile']
    });
    if (result.canceled) {
        log('probeFilePath: user cancelled the file picker', 'warning');
        return null;
    }
    log(`probeFilePath: user picked: ${result.filePaths[0]}`);
    return result.filePaths[0] || null;
}

// ─── Step 2: verify git tracking ─────────────────────────────────────────────

/**
 * Verify the file is tracked by git and return its repo-relative path.
 * `git ls-files --full-name` returns the path relative to the repository root,
 * which is required by `git show <ref>:<path>`.
 *
 * @param {string} fileName  Basename of the .bpmn file.
 * @param {string} dir       Directory containing the file (used as git cwd).
 * @returns {Promise<string>}  e.g. 'src/processes/order.bpmn'
 */
async function getTrackedRelPath(fileName, dir) {
    const cmd = 'git ls-files --full-name ' + JSON.stringify(fileName);
    log(`getTrackedRelPath: running: ${cmd} (cwd: ${dir})`);

    const {stdout} = await execAsync(cmd, {cwd: dir}).catch((e) => {
        log(`getTrackedRelPath: command failed: ${e.message || String(e)}`);
        throw new Error(
            `Command failed: ${dir}/${fileName} is not tracked by git.\n` +
            `Make sure the file is inside a git repository and has been committed at least once.`
        );
    });

    if (!stdout.trim()) {
        throw new Error(
            `Command executed, but output is empty: ${dir}/${fileName} is not tracked by git.\n` +
            `Make sure the file is inside a git repository and has been committed at least once.`
        );
    }
    const relPath = stdout.trim();
    log(`getTrackedRelPath: repo-relative path: ${relPath}`);
    return relPath;
}

// ─── Step 3: resolve the git ref to a concrete SHA ───────────────────────────

/**
 * Resolve `ref` to a concrete SHA and a human-readable label.
 *
 * When `ref` is PREV_FILE_REVISION, runs `git log --follow` to find the commit
 * *before* the last one that touched this specific file — not a repo-wide HEAD~1,
 * which would be wrong if other files were committed in between.
 *
 * @param {string|symbol} ref
 * @param {string}        refLabel
 * @param {string}        relPath   Repo-relative path of the file.
 * @param {string}        dir       Directory containing the file (used as git cwd).
 * @param {string}        fileName  Name of the bpmn file.
 * @returns {Promise<{ resolvedRef: string, resolvedLabel: string }>}
 */
async function resolveGitRef(ref, refLabel, relPath, dir, fileName) {
    if (ref !== PREV_FILE_REVISION) {
        log(`resolveGitRef: using ref "${ref}" as-is`);
        return {resolvedRef: ref, resolvedLabel: refLabel};
    }

    log('resolveGitRef: PREV_FILE_REVISION — finding previous commit for this file');

    // --follow: follows renames so history is preserved even if the file was moved.
    const cmd = `git log --follow -n 2 --pretty=format:"%H" -- ${JSON.stringify(fileName)}`;
    log(`resolveGitRef: running: ${cmd} (cwd: ${dir})`);

    const {stdout} = await execAsync(cmd, {cwd: dir}).catch((err) => {
        error(`resolveGitRef: git log failed: ${err.message || String(err)}`);
        throw new Error(`Could not find a previous revision of ${fileName}: git log failed.`);
    });

    log(`resolveGitRef: git log raw output:\n"${stdout.trim()}"`);

    if (!stdout.trim()) {
        error(`resolveGitRef: git log returned empty output — no commit history for ${relPath}`);
        throw new Error(`Could not find a previous revision of ${fileName}: no commit history.`);
    }

    const hashes = stdout.trim().split('\n').map(h => h.trim());
    log(`resolveGitRef: found ${hashes.length} commit(s): ${hashes.join(', ')}`);

    if (hashes.length < 2) {
        error(`resolveGitRef: only ${hashes.length} commit found — cannot get previous revision`);
        throw new Error(`No previous revision — ${fileName} has only one commit.`);
    }

    // hashes[0] = most recent commit, hashes[1] = the commit before it
    const hash = hashes[1];
    log(`resolveGitRef: selected previous revision hash: ${hash}`);
    return {resolvedRef: hash, resolvedLabel: `prev revision (${hash.slice(0, 7)})`};
}

// ─── Step 4: read the historic XML from the git object store ─────────────────

/**
 * Read the file content at a specific git ref using `git show`.
 *
 * @param {string} resolvedRef    SHA or ref string.
 * @param {string} relPath        Repo-relative path.
 * @param {string} resolvedLabel  Human-readable label for error messages.
 * @param {string} fileName       Name of the bpmn file.
 * @param {string} dir            Directory containing the file (used as git cwd).
 * @returns {Promise<{ stdout: string }>}
 */
async function readGitFileAtRef(resolvedRef, relPath, resolvedLabel, fileName, dir) {
    const cmd = `git show ${resolvedRef}:./${fileName}`;
    log(`readGitFileAtRef: running: ${cmd} (cwd: ${dir})`);
    return execAsync(cmd, {cwd: dir, maxBuffer: 10 * 1024 * 1024}).catch(err => {
        error(`readGitFileAtRef failed: ${err.message || String(err)}`);
        throw new Error(
            `Could not read ${resolvedLabel} version of ${fileName}:\n` +
            (err.message || String(err))
        );
    });
}

// ─── Step 5: open the diff window ────────────────────────────────────────────

/**
 * Close any existing diff window and launch a fresh one for a git comparison.
 * Delegates window creation/tracking to the shared `openDiffWindow` utility.
 *
 * @param {typeof Electron.BrowserWindow} BrowserWindow
 * @param {{ baseXML: string, currentXML: string, fileName: string, resolvedLabel: string }} opts
 */
function launchDiffWindow(BrowserWindow, {baseXML, currentXML, fileName, resolvedLabel}) {
    const htmlPath = path.join(__dirname, '..', 'client', 'diff.html');
    const title = `BPMN Diff \u2014 ${fileName} (${resolvedLabel} vs working tree)`;
    const baseName = `${resolvedLabel} \u2014 ${fileName}`;
    const targetName = `Working tree \u2014 ${fileName}`;
    log(`launchDiffWindow: opening "${title}"`);
    log(`launchDiffWindow: base="${baseName}", target="${targetName}"`);
    const diffWin = openDiffWindow(BrowserWindow, htmlPath, title);
    diffWin.webContents.once('did-finish-load', function () {
        log('launchDiffWindow: window loaded, sending bpmn-diff:init');
        diffWin.webContents.send('bpmn-diff:init', {
            baseXML,
            baseName,
            targetXML: currentXML,
            targetName,
            fileName: fileName.replace(/\.[^.]+$/, '')
        });
    });
}

module.exports = {compareWithGitRef, PREV_FILE_REVISION};
