// @ts-check
// Quiz generation through whatever AI CLI the developer already has. Any CLI
// that takes a prompt and returns text can be added to PROVIDERS.
// Failures throw; the caller decides to fail open.

import { spawnSync } from 'node:child_process';

function buildPrompt(diff, languageName) {
  return `You are a pre-commit gate that checks whether the developer read their changes. Answer immediately with ONLY valid JSON (no markdown, no \`\`\`, no deliberation):

{"summary": ["...", "..."], "statements": [{"text": "...", "is_true": true}, {"text": "...", "is_true": false}, ...]}

- "summary": 3-5 short bullets on what the diff actually changes, behavior-level.
- "statements": exactly 4 about the diff — 2 true + 2 false in random order, each one line, max 140 chars, concrete (file names, functions, exact values), decidable only by reading the diff.
- False ones are near-misses of real facts: inverted condition, wrong value or default, real change attributed to the wrong (but existing) file/function, or claiming the pre-change behavior still holds.
- Never bookkeeping: nothing about files being new/deleted/renamed, line or file counts, imports, formatting, or the change's purpose.
- Prefer statements from different files/areas when the diff touches several.
- Write summary and statements in ${languageName}.

DIFF:
${diff}`;
}

export const PROVIDERS = {
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

/**
 * @param {string|undefined} requested
 * @param {typeof import('./i18n.js').I18N['en']} t
 */
export function detectCli(requested, t) {
  if (requested) {
    if (!PROVIDERS[requested]) throw new Error(t.errUnknownCli(requested));
    return requested;
  }
  for (const cli of Object.keys(PROVIDERS)) {
    const probe = spawnSync('which', [cli], { encoding: 'utf8' });
    if (probe.status === 0) return cli;
  }
  return null;
}

/**
 * @param {string} diff
 * @param {string} cli
 * @param {{model?: string, timeoutMs: number}} options
 * @param {typeof import('./i18n.js').I18N['en']} t
 * @returns {{summary: string[], statements: {text: string, is_true: boolean}[]}}
 */
export function generateQuiz(diff, cli, { model, timeoutMs }, t) {
  const resolvedModel = model ?? (cli === 'claude' ? 'haiku' : undefined);
  const { args: cliArgs, viaStdin } = PROVIDERS[cli](resolvedModel);
  const prompt = buildPrompt(diff, t.languageName);
  const run = (argList) =>
    spawnSync(cli, viaStdin ? argList : [...argList, prompt], {
      input: viaStdin ? prompt : undefined,
      encoding: 'utf8',
      timeout: timeoutMs,
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
    throw new Error(t.errCallFailed(cli, detail));
  }
  const raw = result.stdout ?? '';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(t.errNoJson(cli));
  let quiz;
  try {
    quiz = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error(t.errBadJson);
  }
  const ok =
    Array.isArray(quiz.summary) &&
    Array.isArray(quiz.statements) &&
    quiz.statements.every((s) => typeof s.text === 'string' && typeof s.is_true === 'boolean');
  if (!ok) throw new Error(t.errBadShape);
  // Models sometimes ignore "exactly 4": normalize to 2 true + 2 false.
  const trueOnes = quiz.statements.filter((s) => s.is_true);
  const falseOnes = quiz.statements.filter((s) => !s.is_true);
  if (trueOnes.length < 2 || falseOnes.length < 2) throw new Error(t.errBadShape);
  quiz.statements = [...trueOnes.slice(0, 2), ...falseOnes.slice(0, 2)];
  return quiz;
}

export function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
