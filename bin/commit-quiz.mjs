#!/usr/bin/env node
// commit-quiz: pre-commit comprehension quiz over the staged diff.
// An LLM generates statements about the diff; if the dev cannot tell which
// ones are true, the commit is aborted and the real summary is shown.
//
// Normal use (from a pre-commit hook):  node commit-quiz.mjs
// Try it without staging anything:      node commit-quiz.mjs --range HEAD~1..HEAD
//                                       node commit-quiz.mjs --diff-file changes.diff
// Print the quiz with answers (no prompt): add --dry-run
//
// Environment variables:
//   COMMIT_QUIZ=0              skip the quiz (escape hatch)
//   COMMIT_QUIZ_MIN_LINES=20   minimum changed lines to trigger the quiz
//   COMMIT_QUIZ_CLI            provider: claude | codex | gemini (default: first one installed)
//   COMMIT_QUIZ_MODEL          provider model (default: haiku, claude only)
//   COMMIT_QUIZ_LANG           quiz/UI language: en | es (default: from system locale)
//   COMMIT_QUIZ_TIMEOUT_MS     LLM call timeout (default 90s)

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

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

// ── i18n ─────────────────────────────────────────────────────────────────────

const I18N = {
  en: {
    languageName: 'English',
    failOpen: (reason) => `⚠️  commit-quiz: ${reason} — allowing the commit.\n`,
    generating: (cli, lines) => `🧠 commit-quiz: generating quiz with ${cli} over ${lines} changed lines…\n`,
    quizHeader: '\n🧠 commit-quiz — did you read your changes? Mark the TRUE statements about your diff:\n\n',
    answerPrompt: '\nTrue ones (e.g. 1,3): ',
    dialogPrompt: 'Did you read your changes? Select the TRUE statements about your diff (cmd+click for several):',
    correct: '✅ commit-quiz: correct. Commit allowed.\n',
    wrongHeader: '\n❌ commit-quiz: that does not match your diff. What actually changes:\n\n',
    answersLabel: '\nAnswers:\n',
    reviewHint:
      '\nReview your changes (git diff --cached) and try again.\n' +
      'Justified escape hatch: COMMIT_QUIZ=0 git commit …\n',
    summaryLabel: '— Diff summary —',
    statementsLabel: '\n— Statements —',
    trueMark: 'TRUE ',
    falseMark: 'FALSE',
    truncated: '\n[... diff truncated for the quiz ...]',
    errUnknownCli: (cli) => `COMMIT_QUIZ_CLI=${cli} is not a known provider (claude|codex|gemini)`,
    errNoCli: 'no AI CLI found on PATH (claude, codex or gemini)',
    errCallFailed: (cli, detail) => `could not call ${cli} (${detail ?? 'no detail'})`,
    errNoJson: (cli) => `the ${cli} response contained no JSON`,
    errBadJson: 'could not parse the quiz JSON',
    errBadShape: 'the quiz came back with an unexpected shape',
    errDiffFailed: (detail) => `could not read the diff (${detail})`,
    errNoPromptChannel: 'no terminal or dialog available to ask',
  },
  es: {
    languageName: 'Spanish',
    failOpen: (reason) => `⚠️  commit-quiz: ${reason} — se permite el commit.\n`,
    generating: (cli, lines) => `🧠 commit-quiz: generando quiz con ${cli} sobre ${lines} líneas cambiadas…\n`,
    quizHeader: '\n🧠 commit-quiz — ¿leíste tus cambios? Marca las afirmaciones CIERTAS sobre tu diff:\n\n',
    answerPrompt: '\nCiertas (ej: 1,3): ',
    dialogPrompt: '¿Leíste tus cambios? Selecciona las afirmaciones CIERTAS sobre tu diff (cmd+clic para varias):',
    correct: '✅ commit-quiz: correcto. Commit permitido.\n',
    wrongHeader: '\n❌ commit-quiz: eso no coincide con tu diff. Lo que realmente cambia:\n\n',
    answersLabel: '\nRespuestas:\n',
    reviewHint:
      '\nRevisa tus cambios (git diff --cached) y vuelve a intentar.\n' +
      'Salida de emergencia justificada: COMMIT_QUIZ=0 git commit …\n',
    summaryLabel: '— Resumen del diff —',
    statementsLabel: '\n— Afirmaciones —',
    trueMark: 'CIERTA',
    falseMark: 'FALSA ',
    truncated: '\n[... diff truncado para el quiz ...]',
    errUnknownCli: (cli) => `COMMIT_QUIZ_CLI=${cli} no es un proveedor conocido (claude|codex|gemini)`,
    errNoCli: 'no se encontró ningún CLI de IA (claude, codex o gemini) en el PATH',
    errCallFailed: (cli, detail) => `no se pudo llamar a ${cli} (${detail ?? 'sin detalle'})`,
    errNoJson: (cli) => `la respuesta de ${cli} no trajo JSON`,
    errBadJson: 'no se pudo parsear el JSON del quiz',
    errBadShape: 'el quiz vino con forma inesperada',
    errDiffFailed: (detail) => `no se pudo leer el diff (${detail})`,
    errNoPromptChannel: 'no hay terminal ni diálogo disponible para preguntar',
  },
};

function resolveLang() {
  const explicit = process.env.COMMIT_QUIZ_LANG;
  if (explicit) return I18N[explicit] ? explicit : 'en';
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
  return `You are part of a pre-commit hook that verifies the developer actually read their changes.
Analyze the following git diff and answer ONLY with valid JSON (no markdown, no \`\`\`), in this exact shape:

{"summary": ["...", "..."], "statements": [{"text": "...", "is_true": true}, {"text": "...", "is_true": false}, ...]}

Rules:
- "summary": 3 to 5 short bullets describing what this diff actually changes.
- "statements": exactly 4 statements about the diff: 2 true and 2 false, in random order.
- Every statement must be verifiable by reading ONLY the diff (no intentions, no external context).
- The false ones must be plausible to someone who did NOT read the diff: wrong file, inverted condition, different value or threshold, believable function name. Never absurd or obvious.
- Statements must be concrete (file names, functions, values), one line each.
- Write the summary and the statements in ${T.languageName}.

DIFF:
${diff}`;
}

// Any AI CLI that takes a prompt and returns text will do.
// Use the one requested via COMMIT_QUIZ_CLI, or the first one installed.
const PROVIDERS = {
  // prompt via stdin
  claude: (model) => ({ args: ['-p', ...(model ? ['--model', model] : [])], viaStdin: true }),
  // prompt as argument; --skip-git-repo-check in case the hook runs in odd submodules
  codex: (model) => ({ args: ['exec', '--skip-git-repo-check', ...(model ? ['--model', model] : [])], viaStdin: false }),
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
  const result = spawnSync(cli, viaStdin ? cliArgs : [...cliArgs, prompt], {
    input: viaStdin ? prompt : undefined,
    encoding: 'utf8',
    timeout: LLM_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
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
    quiz.statements.length >= 3 &&
    quiz.statements.every((s) => typeof s.text === 'string' && typeof s.is_true === 'boolean');
  if (!ok) failOpen(T.errBadShape);
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
// With no terminal (commit from the editor UI), macOS falls back to a native
// osascript dialog. With no GUI either: fail open.

function askViaTty(statements) {
  let fd;
  try {
    fd = fs.openSync('/dev/tty', 'r+');
  } catch {
    return null;
  }
  const write = (text) => fs.writeSync(fd, text);
  write(T.quizHeader);
  statements.forEach((s, i) => write(`  ${i + 1}. ${s.text}\n`));
  write(T.answerPrompt);
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
  const script = `choose from list {${items
    .map((t) => JSON.stringify(t))
    .join(', ')}} with title "commit-quiz" with prompt ${JSON.stringify(
    T.dialogPrompt,
  )} with multiple selections allowed`;
  const result = spawnSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 180_000 });
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

process.stderr.write(T.generating(cli, changed));
const quiz = generateQuiz(diff, cli);
const statements = shuffle(quiz.statements);

if (dryRun) {
  console.log(T.summaryLabel);
  quiz.summary.forEach((s) => console.log(`  • ${s}`));
  console.log(T.statementsLabel);
  statements.forEach((s, i) =>
    console.log(`  ${i + 1}. [${s.is_true ? T.trueMark : T.falseMark}] ${s.text}`),
  );
  process.exit(0);
}

const picked = askViaTty(statements) ?? askViaDialog(statements);
if (picked === null) failOpen(T.errNoPromptChannel);

const truth = new Set(statements.flatMap((s, i) => (s.is_true ? [i] : [])));
const correct = picked.size === truth.size && [...truth].every((i) => picked.has(i));

if (correct) {
  process.stderr.write(T.correct);
  process.exit(0);
}

process.stderr.write(T.wrongHeader);
quiz.summary.forEach((s) => process.stderr.write(`  • ${s}\n`));
process.stderr.write(T.answersLabel);
statements.forEach((s, i) =>
  process.stderr.write(`  ${i + 1}. [${s.is_true ? T.trueMark.trim() : T.falseMark.trim()}] ${s.text}\n`),
);
process.stderr.write(T.reviewHint);
process.exit(1);
