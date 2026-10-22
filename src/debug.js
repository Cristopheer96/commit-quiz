// @ts-check
// Opt-in debug logging to a file in the temp dir. Hooks spawned by editor UIs
// have no visible stdout/stderr, so a file is the only reliable trace when
// diagnosing "nothing happened" reports.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEBUG_LOG_FILE = path.join(os.tmpdir(), 'commit-quiz-debug.log');

/** @param {boolean} enabled */
export function createDebugLogger(enabled) {
  if (!enabled) return () => {};
  return (/** @type {string} */ message) => {
    try {
      fs.appendFileSync(
        DEBUG_LOG_FILE,
        `[${new Date().toISOString()}] [pid ${process.pid}] ${message}\n`,
      );
    } catch {
      // debug logging must never break the hook
    }
  };
}
