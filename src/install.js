// @ts-check
// Install/uninstall the hook line in a repo: .husky/pre-commit when the repo
// uses husky (versioned, reaches the whole team), .git/hooks/pre-commit
// otherwise (local to the machine). Idempotent via marker comments.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MARKER_START = '# >>> commit-quiz >>>';
const MARKER_END = '# <<< commit-quiz <<<';
const BLOCK_RE = /\n?# >>> commit-quiz >>>[\s\S]*?# <<< commit-quiz <<<\n?/;

function hookCandidates(target) {
  return [
    path.join(target, '.husky', 'pre-commit'),
    path.join(target, '.git', 'hooks', 'pre-commit'),
  ];
}

function hookPathFor(target) {
  return fs.existsSync(path.join(target, '.husky'))
    ? path.join(target, '.husky', 'pre-commit')
    : path.join(target, '.git', 'hooks', 'pre-commit');
}

function assertRepo(target, t) {
  if (!fs.existsSync(path.join(target, '.git'))) {
    process.stderr.write(t.errNotARepo(target));
    process.exit(1);
  }
}

/**
 * @param {string} target repo root
 * @param {typeof import('./i18n.js').I18N['en']} t
 * @param {string} binPath absolute path of the executable entry, used as fallback
 */
export function installHook(target, t, binPath) {
  assertRepo(target, t);
  const hookPath = hookPathFor(target);
  const current = fs.existsSync(hookPath)
    ? fs.readFileSync(hookPath, 'utf8')
    : '#!/usr/bin/env sh\n';
  if (current.includes('commit-quiz')) {
    process.stdout.write(t.alreadyInstalledAt(hookPath));
    return;
  }
  // Prefer the global command; fall back to this copy's absolute path.
  const onPath = spawnSync('which', ['commit-quiz'], { encoding: 'utf8' }).status === 0;
  const runLine = onPath ? 'commit-quiz' : `node ${JSON.stringify(binPath)}`;
  fs.writeFileSync(
    hookPath,
    `${current}\n${MARKER_START}\n${runLine} || exit 1\n${MARKER_END}\n`,
  );
  fs.chmodSync(hookPath, 0o755);
  process.stdout.write(t.installedAt(hookPath));
}

/**
 * @param {string} target repo root
 * @param {typeof import('./i18n.js').I18N['en']} t
 */
export function uninstallHook(target, t) {
  assertRepo(target, t);
  let removed = false;
  for (const hookPath of hookCandidates(target)) {
    if (!fs.existsSync(hookPath)) continue;
    const current = fs.readFileSync(hookPath, 'utf8');
    if (!BLOCK_RE.test(current)) continue;
    fs.writeFileSync(hookPath, current.replace(BLOCK_RE, '\n'));
    process.stdout.write(t.uninstalledFrom(hookPath));
    removed = true;
  }
  if (!removed) process.stdout.write(t.notInstalledIn(target));
}
