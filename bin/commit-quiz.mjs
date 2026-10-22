#!/usr/bin/env node
// commit-quiz: pre-commit comprehension quiz over the staged diff.
// Thin entry point — argument parsing and the top-level flow. The logic lives
// in src/: config resolution, diff reading, quiz generation, UI, installer.
// Run `commit-quiz --help` for usage.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config.js';
import { createDebugLogger, DEBUG_LOG_FILE } from '../src/debug.js';
import { collectDiff, inMergeOrRebase } from '../src/diff.js';
import { installHook, uninstallHook } from '../src/install.js';
import { detectCli, generateQuiz, shuffle } from '../src/providers.js';
import * as dialogs from '../src/ui/dialogs.js';
import * as term from '../src/ui/terminal.js';

const MAX_DIFF_CHARS = 30_000;

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const optValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const config = loadConfig();
const t = config.t;
const debug = createDebugLogger(config.debug);

// ── subcommands ──────────────────────────────────────────────────────────────

if (hasFlag('--help') || hasFlag('-h') || args[0] === 'help') {
  process.stdout.write(t.helpText);
  process.exit(0);
}
if (hasFlag('--version') || hasFlag('-v')) {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}
if (args[0] === 'install') {
  installHook(path.resolve(args[1] ?? process.cwd()), t, fileURLToPath(import.meta.url));
  process.exit(0);
}
if (args[0] === 'uninstall') {
  uninstallHook(path.resolve(args[1] ?? process.cwd()), t);
  process.exit(0);
}

// ── quiz flow ────────────────────────────────────────────────────────────────

const dryRun = hasFlag('--dry-run');
const diffFile = optValue('--diff-file');
const range = optValue('--range');

// The hook must stay silent when it does not apply, and must never block on
// its own failures (no network, no CLI, broken JSON): fail open with a notice.
function failOpen(reason) {
  debug(`fail-open: ${reason}`);
  process.stderr.write(`${t.failOpen(reason)}\n`);
  process.exit(0);
}

if (config.debug) process.stderr.write(`${t.debugLogAt(DEBUG_LOG_FILE)}\n`);
debug(`start · lang=${config.lang} args=${JSON.stringify(args)}`);

if (config.skip) {
  debug('skipped via COMMIT_QUIZ=0');
  process.exit(0);
}
if (!diffFile && !range && inMergeOrRebase()) {
  debug('skipped: merge/rebase/cherry-pick in progress');
  process.exit(0); // merges/rebases are not "new" commits
}

let diff, changed;
try {
  ({ diff, changed } = collectDiff({ diffFile, range, extraExcludes: config.extraExcludes }));
} catch (err) {
  failOpen(t.errDiffFailed(err.message));
}

if (!diff.trim()) process.exit(0);
if (changed < config.minLines) {
  debug(`skipped: ${changed} changed lines < threshold ${config.minLines}`);
  process.exit(0); // small commits do not pay the toll
}

if (diff.length > MAX_DIFF_CHARS) {
  diff = `${diff.slice(0, MAX_DIFF_CHARS)}${t.truncated}`;
}

let cli;
try {
  cli = detectCli(config.cli, t);
} catch (err) {
  failOpen(err.message);
}
if (!cli) failOpen(t.errNoCli);

const useTerminal = term.canUseTty();
debug(`channel=${useTerminal ? 'terminal' : 'dialog'} cli=${cli} changed=${changed}`);
const notifyHandle = !dryRun && !useTerminal ? dialogs.notify(t) : null;
process.stderr.write(`${t.generating(cli, changed)}\n`);

let quiz;
const startedAt = Date.now();
try {
  quiz = generateQuiz(diff, cli, { model: config.model, timeoutMs: config.timeoutMs }, t);
} catch (err) {
  dialogs.dismissNotify(notifyHandle);
  failOpen(err.message);
}
// Close the heads-up dialog the moment the quiz is ready, so the quiz window
// appears right as the first one disappears.
dialogs.dismissNotify(notifyHandle);
debug(`quiz generated in ${Date.now() - startedAt}ms`);
const statements = shuffle(quiz.statements);

if (dryRun) {
  term.printDryRun(quiz, statements, t);
  process.exit(0);
}

const picked = useTerminal ? term.askViaTty(statements, t) : dialogs.askQuiz(statements, t);
if (picked === null) failOpen(t.errNoPromptChannel);

const truth = new Set(statements.flatMap((s, i) => (s.is_true ? [i] : [])));
const correct = picked.size === truth.size && [...truth].every((i) => picked.has(i));
debug(`answered=[${[...picked].join(',')}] truth=[${[...truth].join(',')}] correct=${correct}`);

if (!useTerminal) dialogs.showResult(correct, quiz, statements, t);

if (correct) {
  term.printPass(t);
  process.exit(0);
}

term.printFail(quiz, statements, t);
process.exit(1);
