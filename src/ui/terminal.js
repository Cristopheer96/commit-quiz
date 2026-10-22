// @ts-check
// Terminal interaction and rendering. Colors only when stderr is a real
// terminal; plain text otherwise (editor output panes, log files).

import fs from 'node:fs';
import tty from 'node:tty';

const COLORS_ON = tty.isatty(2);
const paint = (code, text) => (COLORS_ON ? `\u001b[${code}m${text}\u001b[0m` : text);
export const bold = (t) => paint('1', t);
export const dim = (t) => paint('2', t);
export const red = (t) => paint('31', t);
export const green = (t) => paint('32', t);
export const cyan = (t) => paint('36', t);

export function canUseTty() {
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

/** Parse "1,3"-style answers into a set of zero-based indexes. */
export function parseAnswer(line, count) {
  const picked = new Set();
  for (const match of line.matchAll(/\d+/g)) {
    const n = Number(match[0]);
    if (n >= 1 && n <= count) picked.add(n - 1);
  }
  return picked;
}

/**
 * Ask the quiz on /dev/tty (git runs hooks without interactive stdin).
 * @returns {Set<number>|null} picked indexes, or null if no tty
 */
export function askViaTty(statements, t) {
  let fd;
  try {
    fd = fs.openSync('/dev/tty', 'r+');
  } catch {
    return null;
  }
  const write = (text) => fs.writeSync(fd, text);
  write(`\n${cyan('🧠 commit-quiz')} ${bold(t.quizHeader)}\n\n`);
  statements.forEach((s, i) => write(`  ${cyan(`${i + 1}.`)} ${s.text}\n`));
  write(`\n${bold(t.answerPrompt)}`);
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

export function printDryRun(quiz, statements, t) {
  console.log(bold(`— ${t.summaryLabel} —`));
  quiz.summary.forEach((s) => console.log(`  • ${s}`));
  console.log(bold(`\n— ${t.statementsLabel} —`));
  statements.forEach((s, i) =>
    console.log(
      `  ${i + 1}. ${s.is_true ? green(`[${t.trueTag}]`) : red(`[${t.falseTag}]`)} ${s.text}`,
    ),
  );
}

export function printPass(t) {
  process.stderr.write(`${green('✓')} commit-quiz: ${t.passed}\n`);
}

export function printFail(quiz, statements, t) {
  process.stderr.write(`\n${red('✗')} ${bold(`commit-quiz: ${t.failedTitle}.`)} ${t.failedIntro}\n\n`);
  quiz.summary.forEach((s) => process.stderr.write(`  • ${s}\n`));
  process.stderr.write(`\n${bold(`${t.answersLabel}:`)}\n`);
  statements.forEach((s, i) =>
    process.stderr.write(
      `  ${i + 1}. ${s.is_true ? green(`✓ ${t.trueTag}`) : red(`✗ ${t.falseTag}`)}  ${s.text}\n`,
    ),
  );
  process.stderr.write(`\n${t.reviewHint}\n${dim(t.escapeHint)}\n`);
}
