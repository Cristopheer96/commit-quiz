#!/usr/bin/env node
// commit-quiz: pre-commit comprehension quiz over the staged diff.
// An LLM generates statements about the diff; if the dev cannot tell which
// ones are true, the commit is aborted and the real summary is shown.
//
// Normal use (from a pre-commit hook):  node commit-quiz.mjs
// Install into a repo:                  commit-quiz install [path]
// Try it without staging anything:      node commit-quiz.mjs --range HEAD~1..HEAD
//                                       node commit-quiz.mjs --diff-file changes.diff
// Print the quiz with answers (no prompt): add --dry-run
//
// Environment variables:
//   COMMIT_QUIZ=0              skip the quiz (escape hatch)
//   COMMIT_QUIZ_MIN_LINES=20   minimum changed lines to trigger the quiz
//   COMMIT_QUIZ_CLI            provider: claude | codex | gemini (default: first one installed)
//   COMMIT_QUIZ_MODEL          provider model (default: haiku, claude only)
//   COMMIT_QUIZ_LANG           quiz/UI language: en | es (default: git config commit-quiz.lang, then system locale)
//   COMMIT_QUIZ_TIMEOUT_MS     LLM call timeout (default 90s)

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import tty from 'node:tty';
import { fileURLToPath } from 'node:url';

const MIN_CHANGED_LINES = Number(process.env.COMMIT_QUIZ_MIN_LINES ?? 20);
const LLM_TIMEOUT_MS = Number(process.env.COMMIT_QUIZ_TIMEOUT_MS ?? 90_000);
const MAX_DIFF_CHARS = 30_000;

// Files nobody reads that only inflate the prompt.
const EXCLUDES = [
  ':(exclude)pnpm-lock.yaml',
  ':(exclude)package-lock.json',
  ':(exclude)yarn.lock',
  ':(exclude)Gemfile.lock',
  ':(exclude)Podfile.lock',
  ':(exclude)*.snap',
  ':(exclude)*.svg',
];

// ── terminal styling ─────────────────────────────────────────────────────────
// Colors only when stderr is a real terminal; plain text otherwise (editor
// output panes, log files).

const COLORS_ON = tty.isatty(2);
const paint = (code, text) => (COLORS_ON ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = (t) => paint('1', t);
const dim = (t) => paint('2', t);
const red = (t) => paint('31', t);
const green = (t) => paint('32', t);
const yellow = (t) => paint('33', t);
const cyan = (t) => paint('36', t);

// ── i18n ─────────────────────────────────────────────────────────────────────
// User-facing copy lives here, in English and Spanish. Everything else in the
// codebase — identifiers, comments, prompts to the LLM — is English only.

const I18N = {
  en: {
    languageName: 'English',
    failOpen: (reason) => `${yellow('⚠')} commit-quiz: ${reason} — allowing the commit.\n`,
    generating: (cli, lines) =>
      `${cyan('🧠 commit-quiz')} ${dim(`· generating a quiz with ${cli} over ${lines} changed lines…`)}\n`,
    notifyGenerating: '🧠 Reading your diff… the quiz opens in a few seconds.',
    quizHeader: 'Did you read your changes? Mark the TRUE statements:',
    answerPrompt: 'True ones (e.g. 1,3): ',
    dialogPrompt: 'Did you read your changes?\nSelect the TRUE statements (⌘+click to pick several):',
    passed: 'Nice — that matches your diff. Commit allowed.',
    passedShort: '✅ Commit allowed',
    failedTitle: 'That does not match your diff',
    failedIntro: 'What this diff actually changes:',
    answersLabel: 'Answers',
    trueTag: 'TRUE',
    falseTag: 'FALSE',
    reviewHint: 'Review your changes (git diff --cached) and commit again.',
    escapeHint: 'Justified escape hatch: COMMIT_QUIZ=0 git commit …',
    summaryLabel: 'Diff summary',
    statementsLabel: 'Statements',
    truncated: '\n[... diff truncated for the quiz ...]',
    errUnknownCli: (cli) => `COMMIT_QUIZ_CLI=${cli} is not a known provider (claude|codex|gemini)`,
    errNoCli: 'no AI CLI found on PATH (claude, codex or gemini)',
    errCallFailed: (cli, detail) => `could not call ${cli} (${detail ?? 'no detail'})`,
    errNoJson: (cli) => `the ${cli} response contained no JSON`,
    errBadJson: 'could not parse the quiz JSON',
    errBadShape: 'the quiz came back with an unexpected shape',
    errDiffFailed: (detail) => `could not read the diff (${detail})`,
    errNoPromptChannel: 'no terminal or dialog available to ask',
    installedAt: (hook) =>
      `✅ commit-quiz installed in ${hook}\n   To remove it: delete the block between the commit-quiz markers.\n`,
    alreadyInstalledAt: (hook) => `✅ commit-quiz was already installed in ${hook}\n`,
    errNotARepo: (target) => `❌ ${target} does not look like a git repo.\n`,
  },
  es: {
    languageName: 'Spanish',
    failOpen: (reason) => `${yellow('⚠')} commit-quiz: ${reason} — se permite el commit.\n`,
    generating: (cli, lines) =>
      `${cyan('🧠 commit-quiz')} ${dim(`· generando un quiz con ${cli} sobre ${lines} líneas cambiadas…`)}\n`,
    notifyGenerating: '🧠 Leyendo tu diff… el quiz aparece en unos segundos.',
    quizHeader: '¿Leíste tus cambios? Marca las afirmaciones CIERTAS:',
    answerPrompt: 'Ciertas (ej: 1,3): ',
    dialogPrompt: '¿Leíste tus cambios?\nSelecciona las afirmaciones CIERTAS (⌘+clic para elegir varias):',
    passed: 'Bien — eso coincide con tu diff. Commit permitido.',
    passedShort: '✅ Commit permitido',
    failedTitle: 'Eso no coincide con tu diff',
    failedIntro: 'Lo que realmente cambia este diff:',
    answersLabel: 'Respuestas',
    trueTag: 'CIERTA',
    falseTag: 'FALSA',
    reviewHint: 'Revisa tus cambios (git diff --cached) y vuelve a commitear.',
    escapeHint: 'Salida de emergencia justificada: COMMIT_QUIZ=0 git commit …',
    summaryLabel: 'Resumen del diff',
    statementsLabel: 'Afirmaciones',
    truncated: '\n[... diff truncado para el quiz ...]',
    errUnknownCli: (cli) => `COMMIT_QUIZ_CLI=${cli} no es un proveedor conocido (claude|codex|gemini)`,
    errNoCli: 'no se encontró ningún CLI de IA (claude, codex o gemini) en el PATH',
    errCallFailed: (cli, detail) => `no se pudo llamar a ${cli} (${detail ?? 'sin detalle'})`,
    errNoJson: (cli) => `la respuesta de ${cli} no trajo JSON`,
    errBadJson: 'no se pudo parsear el JSON del quiz',
    errBadShape: 'el quiz vino con forma inesperada',
    errDiffFailed: (detail) => `no se pudo leer el diff (${detail})`,
    errNoPromptChannel: 'no hay terminal ni diálogo disponible para preguntar',
    installedAt: (hook) =>
      `✅ commit-quiz instalado en ${hook}\n   Para quitarlo: borra el bloque entre los marcadores commit-quiz.\n`,
    alreadyInstalledAt: (hook) => `✅ commit-quiz ya estaba instalado en ${hook}\n`,
    errNotARepo: (target) => `❌ ${target} no parece un repo git.\n`,
  },
};

function resolveLang() {
  const explicit = process.env.COMMIT_QUIZ_LANG;
  if (explicit) return I18N[explicit] ? explicit : 'en';
  // git config also reaches hooks launched from the editor UI, where LANG is
  // not inherited: git config --global commit-quiz.lang es
  try {
    const configured = execFileSync('git', ['config', 'commit-quiz.lang'], {
      encoding: 'utf8',
    }).trim();
    if (I18N[configured]) return configured;
  } catch {
    // not configured: fall through to the locale
  }
  const locale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  return locale.toLowerCase().startsWith('es') ? 'es' : 'en';
}

const LANG = resolveLang();
const T = I18N[LANG];

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const optValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const dryRun = hasFlag('--dry-run');
const diffFile = optValue('--diff-file');
const range = optValue('--range');

// ── git helpers ──────────────────────────────────────────────────────────────

function git(...gitArgs) {
  return execFileSync('git', gitArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

// The hook must stay silent when it does not apply, and must never block on
// its own failures (no network, no CLI, broken JSON): fail open with a notice.
function failOpen(reason) {
  process.stderr.write(T.failOpen(reason));
  process.exit(0);
}

function countChangedLines(numstat) {
  let total = 0;
  for (const line of numstat.split('\n')) {
    const [added, deleted] = line.split('\t');
    if (!added || added === '-') continue; // binary files
    total += Number(added) + Number(deleted);
  }
  return total;
}

function collectDiff() {
  if (diffFile) {
    const diff = fs.readFileSync(diffFile, 'utf8');
    const changed = diff.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length;
    return { diff, changed };
  }
  const base = range ? ['diff', range] : ['diff', '--cached'];
  const numstat = git(...base, '--numstat', '--', '.', ...EXCLUDES);
  const diff = git(...base, '--unified=1', '--no-color', '--', '.', ...EXCLUDES);
  return { diff, changed: countChangedLines(numstat) };
}

function inMergeOrRebase() {
  try {
    const gitDir = git('rev-parse', '--git-dir').trim();
    return ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD'].some((f) =>
      fs.existsSync(`${gitDir}/${f}`),
    );
  } catch {
    return false;
  }
}

// ── quiz generation ──────────────────────────────────────────────────────────

function buildPrompt(diff) {
  return `You are a pre-commit gate that checks whether the developer read their changes. Answer immediately with ONLY valid JSON (no markdown, no \`\`\`, no deliberation):

{"summary": ["...", "..."], "statements": [{"text": "...", "is_true": true}, {"text": "...", "is_true": false}, ...]}

- "summary": 3-5 short bullets on what the diff actually changes, behavior-level.
- "statements": exactly 4 about the diff — 2 true + 2 false in random order, each one line, max 140 chars, concrete (file names, functions, exact values), decidable only by reading the diff.
- False ones are near-misses of real facts: inverted condition, wrong value or default, real change attributed to the wrong (but existing) file/function, or claiming the pre-change behavior still holds.
- Never bookkeeping: nothing about files being new/deleted/renamed, line or file counts, imports, formatting, or the change's purpose.
- Prefer statements from different files/areas when the diff touches several.
- Write summary and statements in ${T.languageName}.

DIFF:
${diff}`;
}

// Any AI CLI that takes a prompt and returns text will do.
// Use the one requested via COMMIT_QUIZ_CLI, or the first one installed.
const PROVIDERS = {
  // prompt via stdin; --strict-mcp-config skips the user's MCP servers and
  // --effort low trims reasoning time
  claude: (model) => ({
    args: ['-p', '--strict-mcp-config', '--effort', 'low', ...(model ? ['--model', model] : [])],
    viaStdin: true,
  }),
  // prompt as argument; --skip-git-repo-check in case the hook runs in odd submodules
  codex: (model) => ({
    args: ['exec', '--skip-git-repo-check', ...(model ? ['--model', model] : [])],
    viaStdin: false,
  }),
  gemini: (model) => ({ args: ['-p', ...(model ? ['-m', model] : [])], viaStdin: false }),
};

function detectCli() {
  const wanted = process.env.COMMIT_QUIZ_CLI;
  if (wanted) {
    if (!PROVIDERS[wanted]) failOpen(T.errUnknownCli(wanted));
    return wanted;
  }
  for (const cli of Object.keys(PROVIDERS)) {
    const probe = spawnSync('which', [cli], { encoding: 'utf8' });
    if (probe.status === 0) return cli;
  }
  return null;
}

function generateQuiz(diff, cli) {
  const model = process.env.COMMIT_QUIZ_MODEL ?? (cli === 'claude' ? 'haiku' : undefined);
  const { args: cliArgs, viaStdin } = PROVIDERS[cli](model);
  const prompt = buildPrompt(diff);
  const run = (argList) =>
    spawnSync(cli, viaStdin ? argList : [...argList, prompt], {
      input: viaStdin ? prompt : undefined,
      encoding: 'utf8',
      timeout: LLM_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      // extended thinking adds 30+ seconds per quiz with no quality gain here
      env: { ...process.env, MAX_THINKING_TOKENS: '0' },
    });
  let result = run(cliArgs);
  if ((result.error || result.status !== 0) && cliArgs.includes('--effort')) {
    // older CLIs without --effort: retry without the flag
    const stripped = cliArgs.filter((a, i) => a !== '--effort' && cliArgs[i - 1] !== '--effort');
    result = run(stripped);
  }
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.slice(0, 200);
    failOpen(T.errCallFailed(cli, detail));
  }
  const raw = result.stdout ?? '';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) failOpen(T.errNoJson(cli));
  let quiz;
  try {
    quiz = JSON.parse(raw.slice(start, end + 1));
  } catch {
    failOpen(T.errBadJson);
  }
  const ok =
    Array.isArray(quiz.summary) &&
    Array.isArray(quiz.statements) &&
    quiz.statements.every((s) => typeof s.text === 'string' && typeof s.is_true === 'boolean');
  if (!ok) failOpen(T.errBadShape);
  // Models sometimes ignore "exactly 4": normalize to 2 true + 2 false.
  const trueOnes = quiz.statements.filter((s) => s.is_true);
  const falseOnes = quiz.statements.filter((s) => !s.is_true);
  if (trueOnes.length < 2 || falseOnes.length < 2) failOpen(T.errBadShape);
  quiz.statements = [...trueOnes.slice(0, 2), ...falseOnes.slice(0, 2)];
  return quiz;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ── interaction ──────────────────────────────────────────────────────────────
// git runs hooks without interactive stdin, so /dev/tty is opened directly.
// With no real terminal (commit from the editor UI), macOS gets native
// dialogs. With no GUI either: fail open.

function canUseTty() {
  // Editor-spawned git can still open /dev/tty when the editor was launched
  // from a shell, but nobody is looking at that terminal. Only trust the tty
  // when the hook's own stderr is one (i.e. the commit came from a terminal).
  if (!tty.isatty(2)) return false;
  try {
    const fd = fs.openSync('/dev/tty', 'r+');
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

// Fire-and-forget AppleScript (detached so neither generation nor the commit
// waits on it).
function osaDetached(script) {
  spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
}

// Immediate heads-up on editor-UI commits: with no terminal the "generating…"
// line is invisible and the LLM wait looks like a hang. A self-dismissing
// dialog is used because notifications depend on per-app permissions.
function notify(message) {
  if (process.platform !== 'darwin') return;
  osaDetached(`tell application "System Events"
activate
display dialog ${JSON.stringify(message)} buttons {"OK"} default button "OK" giving up after 4 with title "commit-quiz"
end tell`);
}

function askViaTty(statements) {
  let fd;
  try {
    fd = fs.openSync('/dev/tty', 'r+');
  } catch {
    return null;
  }
  const write = (text) => fs.writeSync(fd, text);
  write(`\n${cyan('🧠 commit-quiz')} ${bold(T.quizHeader)}\n\n`);
  statements.forEach((s, i) => write(`  ${cyan(`${i + 1}.`)} ${s.text}\n`));
  write(`\n${bold(T.answerPrompt)}`);
  let line = '';
  const buf = Buffer.alloc(64);
  while (true) {
    let n;
    try {
      n = fs.readSync(fd, buf, 0, buf.length, null);
    } catch (err) {
      if (err.code === 'EAGAIN') continue;
      fs.closeSync(fd);
      return null;
    }
    if (n === 0) break;
    line += buf.toString('utf8', 0, n);
    if (line.includes('\n')) break;
  }
  fs.closeSync(fd);
  return parseAnswer(line, statements.length);
}

function askViaDialog(statements) {
  if (process.platform !== 'darwin') return null;
  const items = statements.map((s, i) => `${i + 1}. ${s.text}`);
  // activate: without it the dialog opens behind the editor window
  const script = `tell application "System Events"
activate
choose from list {${items
    .map((t) => JSON.stringify(t))
    .join(', ')}} with title "🧠 commit-quiz" with prompt ${JSON.stringify(
    T.dialogPrompt,
  )} with multiple selections allowed
end tell`;
  const result = spawnSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 600_000 });
  if (result.error || result.status !== 0) return null;
  const out = result.stdout.trim();
  if (out === 'false' || out === '') return new Set(); // cancelled or nothing selected
  const picked = new Set();
  for (const match of out.matchAll(/(?:^|, )(\d+)\. /g)) picked.add(Number(match[1]) - 1);
  return picked;
}

function parseAnswer(line, count) {
  const picked = new Set();
  for (const match of line.matchAll(/\d+/g)) {
    const n = Number(match[0]);
    if (n >= 1 && n <= count) picked.add(n - 1);
  }
  return picked;
}

// Editor-UI commits never show the hook's stderr up front, so the verdict gets
// its own native dialog: a short self-dismissing one on success, a blocking
// one with the real summary and answers on failure.
function showResultDialog(correct, quiz, statements) {
  if (process.platform !== 'darwin') return;
  if (correct) {
    osaDetached(`tell application "System Events"
activate
display dialog ${JSON.stringify(`${T.passedShort} — ${T.passed}`)} buttons {"OK"} default button "OK" giving up after 3 with title "commit-quiz"
end tell`);
    return;
  }
  const answers = statements
    .map((s, i) => `${i + 1}. [${s.is_true ? T.trueTag : T.falseTag}] ${s.text}`)
    .join('\n');
  const body = [
    T.failedIntro,
    '',
    quiz.summary.map((s) => `• ${s}`).join('\n'),
    '',
    `${T.answersLabel}:`,
    answers,
    '',
    T.reviewHint,
  ].join('\n');
  osaDetached(`tell application "System Events"
activate
display dialog ${JSON.stringify(`❌ ${T.failedTitle}\n\n${body}`)} buttons {"OK"} default button "OK" with title "commit-quiz"
end tell`);
}

// ── installer: `commit-quiz install [path]` ──────────────────────────────────
// Appends the hook line to .husky/pre-commit (if the repo uses husky) or to
// .git/hooks/pre-commit. Idempotent: the marker block is never duplicated.

function installHook(target) {
  if (!fs.existsSync(path.join(target, '.git'))) {
    process.stderr.write(T.errNotARepo(target));
    process.exit(1);
  }
  const huskyDir = path.join(target, '.husky');
  const hookPath = fs.existsSync(huskyDir)
    ? path.join(huskyDir, 'pre-commit')
    : path.join(target, '.git', 'hooks', 'pre-commit');

  const current = fs.existsSync(hookPath)
    ? fs.readFileSync(hookPath, 'utf8')
    : '#!/usr/bin/env sh\n';
  if (current.includes('commit-quiz')) {
    process.stdout.write(T.alreadyInstalledAt(hookPath));
    process.exit(0);
  }

  // Prefer the global command; fall back to this file's absolute path.
  const onPath = spawnSync('which', ['commit-quiz'], { encoding: 'utf8' }).status === 0;
  const runLine = onPath ? 'commit-quiz' : `node ${JSON.stringify(fileURLToPath(import.meta.url))}`;

  fs.writeFileSync(
    hookPath,
    `${current}\n# >>> commit-quiz >>>\n${runLine} || exit 1\n# <<< commit-quiz <<<\n`,
  );
  fs.chmodSync(hookPath, 0o755);
  process.stdout.write(T.installedAt(hookPath));
  process.exit(0);
}

if (args[0] === 'install') installHook(path.resolve(args[1] ?? process.cwd()));

// ── main ─────────────────────────────────────────────────────────────────────

if (process.env.COMMIT_QUIZ === '0') process.exit(0);
if (!diffFile && !range && inMergeOrRebase()) process.exit(0); // merges/rebases are not "new" commits

let diff, changed;
try {
  ({ diff, changed } = collectDiff());
} catch (err) {
  failOpen(T.errDiffFailed(err.message));
}

if (!diff.trim()) process.exit(0);
if (changed < MIN_CHANGED_LINES) process.exit(0); // small commits do not pay the toll

if (diff.length > MAX_DIFF_CHARS) {
  diff = `${diff.slice(0, MAX_DIFF_CHARS)}${T.truncated}`;
}

const cli = detectCli();
if (!cli) failOpen(T.errNoCli);

const useTerminal = canUseTty();
if (!dryRun && !useTerminal) notify(T.notifyGenerating);
process.stderr.write(T.generating(cli, changed));
const quiz = generateQuiz(diff, cli);
const statements = shuffle(quiz.statements);

if (dryRun) {
  console.log(bold(`— ${T.summaryLabel} —`));
  quiz.summary.forEach((s) => console.log(`  • ${s}`));
  console.log(bold(`\n— ${T.statementsLabel} —`));
  statements.forEach((s, i) =>
    console.log(
      `  ${i + 1}. ${s.is_true ? green(`[${T.trueTag}]`) : red(`[${T.falseTag}]`)} ${s.text}`,
    ),
  );
  process.exit(0);
}

const picked = useTerminal ? askViaTty(statements) : askViaDialog(statements);
if (picked === null) failOpen(T.errNoPromptChannel);

const truth = new Set(statements.flatMap((s, i) => (s.is_true ? [i] : [])));
const correct = picked.size === truth.size && [...truth].every((i) => picked.has(i));

if (!useTerminal) showResultDialog(correct, quiz, statements);

if (correct) {
  process.stderr.write(`${green('✓')} commit-quiz: ${T.passed}\n`);
  process.exit(0);
}

process.stderr.write(`\n${red('✗')} ${bold(`commit-quiz: ${T.failedTitle}.`)} ${T.failedIntro}\n\n`);
quiz.summary.forEach((s) => process.stderr.write(`  • ${s}\n`));
process.stderr.write(`\n${bold(`${T.answersLabel}:`)}\n`);
statements.forEach((s, i) =>
  process.stderr.write(
    `  ${i + 1}. ${s.is_true ? green(`✓ ${T.trueTag}`) : red(`✗ ${T.falseTag}`)}  ${s.text}\n`,
  ),
);
process.stderr.write(`\n${T.reviewHint}\n${dim(T.escapeHint)}\n`);
process.exit(1);
