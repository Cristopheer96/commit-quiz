// @ts-check
// Reading the diff out of git: staged changes by default, or a commit range /
// saved diff file for testing the tool without staging anything.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// Files nobody reads that only inflate the prompt.
export const BASE_EXCLUDES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'Gemfile.lock',
  'Podfile.lock',
  '*.snap',
  '*.svg',
];

export function git(...gitArgs) {
  return execFileSync('git', gitArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
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

/**
 * @param {{diffFile?: string, range?: string, extraExcludes?: string[]}} options
 * @returns {{diff: string, changed: number}}
 */
export function collectDiff({ diffFile, range, extraExcludes = [] } = {}) {
  if (diffFile) {
    const diff = fs.readFileSync(diffFile, 'utf8');
    const changed = diff.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length;
    return { diff, changed };
  }
  const excludes = [...BASE_EXCLUDES, ...extraExcludes].map((p) => `:(exclude)${p}`);
  const base = range ? ['diff', range] : ['diff', '--cached'];
  const numstat = git(...base, '--numstat', '--', '.', ...excludes);
  const diff = git(...base, '--unified=1', '--no-color', '--', '.', ...excludes);
  return { diff, changed: countChangedLines(numstat) };
}

export function inMergeOrRebase() {
  try {
    const gitDir = git('rev-parse', '--git-dir').trim();
    return ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD'].some((f) =>
      fs.existsSync(`${gitDir}/${f}`),
    );
  } catch {
    return false;
  }
}
