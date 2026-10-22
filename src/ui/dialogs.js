// @ts-check
// Native dialogs for commits launched from an editor UI, where the hook has no
// visible terminal: osascript on macOS, zenity on Linux when available.
// Emojis carry the visual signal; AppleScript stock icons render inconsistently
// under System Events, so none are used.

import { spawn, spawnSync } from 'node:child_process';
import { parseAnswer } from './terminal.js';

const DIALOG_TIMEOUT_MS = 600_000;

function hasCommand(cmd) {
  return spawnSync('which', [cmd], { encoding: 'utf8' }).status === 0;
}

// Fire-and-forget process (detached so neither generation nor the commit
// waits on it). Returns the child so callers can dismiss it early.
function fireAndForget(cmd, cmdArgs) {
  const child = spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true });
  child.unref();
  return child;
}

function osaDetached(script) {
  fireAndForget('osascript', ['-e', script]);
}

// Wrapping dialogs in `tell application "System Events"` brings them to the
// front, but macOS requires per-app Automation permission for it (the calling
// app, e.g. the editor, must be allowed to control System Events). When that
// permission is missing the whole script fails silently, so probe once and
// fall back to plain dialogs (which may open behind, but do open).
let systemEventsAllowed;
function canUseSystemEvents() {
  if (systemEventsAllowed === undefined) {
    const probe = spawnSync(
      'osascript',
      ['-e', 'tell application "System Events" to count processes'],
      { encoding: 'utf8', timeout: 10_000 },
    );
    systemEventsAllowed = probe.status === 0;
  }
  return systemEventsAllowed;
}

function withActivate(body) {
  return canUseSystemEvents()
    ? `tell application "System Events"\nactivate\n${body}\nend tell`
    : body;
}

// Immediate heads-up: with no terminal the "generating…" line is invisible
// and the LLM wait looks like a hang. A dialog is used on macOS because
// notifications depend on per-app permissions. It is NOT wrapped in System
// Events on purpose: a plain `display dialog` is owned by our own osascript
// process, so killing that process closes the dialog the instant the quiz is
// ready — no dead gap between the two windows. Returns a handle for
// dismissNotify.
export function notify(t) {
  if (process.platform === 'darwin') {
    return fireAndForget('osascript', [
      '-e',
      `display dialog ${JSON.stringify(t.notifyGenerating)} buttons {"OK"} default button "OK" giving up after 90 with title "commit-quiz"`,
    ]);
  }
  if (process.platform === 'linux' && hasCommand('zenity')) {
    return fireAndForget('zenity', ['--notification', `--text=${t.notifyGenerating}`]);
  }
  return null;
}

// Close the "generating…" dialog right before showing the quiz.
export function dismissNotify(handle) {
  if (!handle) return;
  try {
    handle.kill('SIGKILL');
  } catch {
    // already gone (user clicked OK or it gave up)
  }
}

/**
 * Ask the quiz in a native dialog.
 * @returns {Set<number>|null} picked indexes, or null when no dialog backend exists
 */
export function askQuiz(statements, t) {
  if (process.platform === 'darwin') {
    const items = statements.map((s, i) => `${i + 1}. ${s.text}`);
    // activate (when permitted): without it the dialog opens behind the editor window
    const script = withActivate(
      `choose from list {${items
        .map((item) => JSON.stringify(item))
        .join(', ')}} with title "🧠 commit-quiz" with prompt ${JSON.stringify(
        t.dialogPrompt,
      )} with multiple selections allowed`,
    );
    const result = spawnSync('osascript', ['-e', script], {
      encoding: 'utf8',
      timeout: DIALOG_TIMEOUT_MS,
    });
    if (result.error || result.status !== 0) return null;
    const out = result.stdout.trim();
    if (out === 'false' || out === '') return new Set(); // cancelled or nothing selected
    const picked = new Set();
    for (const match of out.matchAll(/(?:^|, )(\d+)\. /g)) picked.add(Number(match[1]) - 1);
    return picked;
  }
  if (process.platform === 'linux' && hasCommand('zenity')) {
    const rows = statements.flatMap((s, i) => ['FALSE', String(i + 1), s.text]);
    const result = spawnSync(
      'zenity',
      [
        '--list',
        '--checklist',
        '--title=🧠 commit-quiz',
        `--text=${t.dialogPrompt}`,
        '--column=',
        '--column=#',
        `--column=${t.statementsLabel}`,
        '--separator=,',
        '--width=760',
        '--height=320',
        ...rows,
      ],
      { encoding: 'utf8', timeout: DIALOG_TIMEOUT_MS },
    );
    if (result.error || result.status === null) return null;
    if (result.status !== 0) return new Set(); // cancelled
    return parseAnswer(result.stdout, statements.length);
  }
  return null;
}

// Editor-UI commits never show the hook's stderr up front, so the verdict gets
// its own native dialog: a short self-dismissing one on success, a persistent
// one with the real summary and answers on failure.
export function showResult(correct, quiz, statements, t) {
  const failBody = () =>
    [
      `❌ ${t.failedTitle}`,
      '',
      t.failedIntro,
      '',
      quiz.summary.map((s) => `• ${s}`).join('\n'),
      '',
      `${t.answersLabel}:`,
      statements
        .map((s, i) => `${i + 1}. [${s.is_true ? t.trueTag : t.falseTag}] ${s.text}`)
        .join('\n'),
      '',
      t.reviewHint,
    ].join('\n');

  if (process.platform === 'darwin') {
    if (correct) {
      osaDetached(
        withActivate(
          `display dialog ${JSON.stringify(`${t.passedShort} — ${t.passed}`)} buttons {"OK"} default button "OK" giving up after 3 with title "commit-quiz"`,
        ),
      );
    } else {
      osaDetached(
        withActivate(
          `display dialog ${JSON.stringify(failBody())} buttons {"OK"} default button "OK" with title "commit-quiz"`,
        ),
      );
    }
    return;
  }
  if (process.platform === 'linux' && hasCommand('zenity')) {
    if (correct) {
      fireAndForget('zenity', ['--notification', `--text=${t.passedShort} — ${t.passed}`]);
    } else {
      fireAndForget('zenity', ['--error', '--title=commit-quiz', `--text=${failBody()}`]);
    }
  }
}
