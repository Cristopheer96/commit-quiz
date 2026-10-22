// @ts-check
// Configuration resolution. Precedence: environment variable > git config
// (per repo or --global) > default. git config is the team-friendly channel:
// it is versionable via `git config --file` setups and reaches editor-spawned
// hooks where the user's shell environment does not.

import { execFileSync } from 'node:child_process';
import { I18N, pickLang } from './i18n.js';

function gitConfigGet(key) {
  try {
    const value = execFileSync('git', ['config', '--get', key], { encoding: 'utf8' }).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function gitConfigGetAll(key) {
  try {
    return execFileSync('git', ['config', '--get-all', key], { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function loadConfig(env = process.env) {
  const lang = pickLang(
    env.COMMIT_QUIZ_LANG,
    gitConfigGet('commit-quiz.lang'),
    env.LC_ALL || env.LC_MESSAGES || env.LANG || '',
  );
  return {
    lang,
    t: I18N[lang],
    skip: env.COMMIT_QUIZ === '0',
    minLines: Number(env.COMMIT_QUIZ_MIN_LINES ?? gitConfigGet('commit-quiz.minlines') ?? 20),
    cli: env.COMMIT_QUIZ_CLI ?? gitConfigGet('commit-quiz.cli'),
    model: env.COMMIT_QUIZ_MODEL ?? gitConfigGet('commit-quiz.model'),
    timeoutMs: Number(env.COMMIT_QUIZ_TIMEOUT_MS ?? gitConfigGet('commit-quiz.timeoutms') ?? 90_000),
    extraExcludes: gitConfigGetAll('commit-quiz.exclude'),
    debug: env.COMMIT_QUIZ_DEBUG === '1' || gitConfigGet('commit-quiz.debug') === 'true',
  };
}
