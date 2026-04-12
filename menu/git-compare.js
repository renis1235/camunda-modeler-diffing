'use strict';

const {promisify} = require('util');
const {exec} = require('child_process');
const fs = require('fs');
const path = require('path');
const {probeActiveFilePath, openDiffWindow} = require('./bpmn-utils');

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

    const filePath = await probeFilePath(mainWin, electronApp, dialog);
    if (!filePath) {
        return; // user cancelled the picker
    }

    const fileName = path.basename(filePath);
    const dir = path.dirname(filePath);

    try {
        const relPath = await getTrackedRelPath(fileName, dir);
        const {resolvedRef, resolvedLabel} = await resolveGitRef(ref, refLabel, relPath, dir, fileName);
        const {stdout: baseXML} = await readGitFileAtRef(resolvedRef, relPath, resolvedLabel, fileName, dir);
        const currentXML = await readFileAsync(filePath, 'utf8');

        launchDiffWindow(BrowserWindow, {baseXML, currentXML, fileName, resolvedLabel});
    } catch (err) {
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
    const filePath = await probeActiveFilePath(mainWin, electronApp);
    if (filePath) {
        return filePath;
    }

    // Attempt 3: ask the user to pick the file manually.
    const result = await dialog.showOpenDialog({
        title: 'Select the BPMN file to compare',
        filters: [{name: 'BPMN files', extensions: ['bpmn', 'xml']}],
        properties: ['openFile']
    });
    return result.canceled ? null : (result.filePaths[0] || null);
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
    const {stdout} = await execAsync(
        'git ls-files --full-name ' + JSON.stringify(fileName),
        {cwd: dir}
    ).catch(() => {
        throw new Error(
            `${dir}/${fileName} is not tracked by git.\n` +
            `Make sure the file is inside a git repository and has been committed at least once.`
        );
    });

    if (!stdout.trim()) {
        throw new Error(
            `${dir}/${fileName} is not tracked by git.\n` +
            `Make sure the file is inside a git repository and has been committed at least once.`
        );
    }
    return stdout.trim();
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
 * @param {string}        dir       Git working directory.
 * @param {string}        fileName  Used in error messages.
 * @returns {Promise<{ resolvedRef: string, resolvedLabel: string }>}
 */
async function resolveGitRef(ref, refLabel, relPath, dir, fileName) {
    if (ref !== PREV_FILE_REVISION) {
        return {resolvedRef: ref, resolvedLabel: refLabel};
    }

    // --follow: follows renames so history is preserved even if the file was moved.
    const {stdout} = await execAsync(
        `git log --follow -n 2 --pretty=format:"%H" -- ${relPath}`,
        {cwd: dir}
    ).catch(() => {
        throw new Error(`Could not find a previous revision of ${fileName}: git log failed.`);
    });

    if (!stdout.trim()) {
        throw new Error(`Could not find a previous revision of ${fileName}: no commit history.`);
    }

    const hashes = stdout.trim().split('\n');
    if (hashes.length < 2) {
        throw new Error(`No previous revision — ${fileName} has only one commit.`);
    }

    // hashes[0] = most recent commit, hashes[1] = the commit before it
    const hash = hashes[1].trim();
    return {resolvedRef: hash, resolvedLabel: `prev revision (${hash.slice(0, 7)})`};
}

// ─── Step 4: read the historic XML from the git object store ─────────────────

/**
 * Read the file content at a specific git ref using `git show`.
 *
 * @param {string} resolvedRef    SHA or ref string.
 * @param {string} relPath        Repo-relative path.
 * @param {string} resolvedLabel  Human-readable label for error messages.
 * @param {string} fileName       Basename for error messages.
 * @param {string} dir            Git working directory.
 * @returns {Promise<{ stdout: string }>}
 */
async function readGitFileAtRef(resolvedRef, relPath, resolvedLabel, fileName, dir) {
    return execAsync(
        `git show ${resolvedRef}:${relPath}`,
        {cwd: dir, maxBuffer: 10 * 1024 * 1024}
    ).catch(err => {
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
    const diffWin = openDiffWindow(BrowserWindow, htmlPath, title);
    diffWin.webContents.once('did-finish-load', function () {
        diffWin.webContents.send('bpmn-diff:init', {
            baseXML,
            baseName: `${resolvedLabel} \u2014 ${fileName}`,
            targetXML: currentXML,
            targetName: `Working tree \u2014 ${fileName}`,
            fileName: fileName.replace(/\.[^.]+$/, '')
        });
    });
}

module.exports = {compareWithGitRef, PREV_FILE_REVISION};
