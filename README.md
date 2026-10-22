# commit-quiz

A `pre-commit` hook that verifies the developer **actually read their changes**
before committing. Useful when AI agents (Claude Code, Cursor, Codex…) generate
the code and the dev just hits "commit" without reviewing.

## How it works

1. On commit, the hook takes the staged diff (`git diff --cached`).
2. It sends it to an AI CLI and generates **4 statements about the diff: 2 true
   and 2 plausible-but-false** (wrong file, inverted condition, different
   value…).
3. The dev marks which ones are true:
   - **In a terminal**: interactive prompt via `/dev/tty`.
   - **From the VS Code/Cursor UI** (no terminal): native macOS dialog via
     `osascript`.
4. On a correct answer the commit goes through. On a wrong one the commit is
   aborted and the **real summary** of the diff is shown.

The hook is **fail-open**: if the LLM does not respond, there is no network, or
there is no way to ask, the commit goes through with a notice. A gate that gets
in the way ends up disabled; this one only gets in the way when it can do its
job.

## Requirements

- Node ≥ 18.
- Some AI CLI on the PATH: [Claude Code](https://claude.com/claude-code)
  (`claude`), OpenAI Codex CLI (`codex`) or Gemini CLI (`gemini`). The first
  one found is used, or the one set via `COMMIT_QUIZ_CLI`. Each dev uses their
  own session/account — no shared API key.
- macOS for the native dialog (on Linux/Windows only the terminal mode works).

## Install into a repo

```bash
./install.sh /path/to/repo
```

Detects whether the repo uses husky (`.husky/pre-commit`) and appends itself at
the end; otherwise it uses `.git/hooks/pre-commit`. Idempotent: running it
twice does not duplicate anything.

## Try it without staging anything

```bash
# Quiz over a repo's last commit, with answers visible:
cd /path/to/repo
node /path/to/commit-quiz/bin/commit-quiz.mjs --range HEAD~1..HEAD --dry-run

# Same but interactive (as the dev would see it):
node /path/to/commit-quiz/bin/commit-quiz.mjs --range HEAD~1..HEAD

# Over a diff saved to a file:
node /path/to/commit-quiz/bin/commit-quiz.mjs --diff-file changes.diff --dry-run
```

## Configuration (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `COMMIT_QUIZ=0` | — | Skips the quiz for that commit (escape hatch) |
| `COMMIT_QUIZ_MIN_LINES` | `20` | Minimum changed lines to trigger the quiz |
| `COMMIT_QUIZ_CLI` | auto | Provider: `claude`, `codex` or `gemini` |
| `COMMIT_QUIZ_MODEL` | `haiku` (claude only) | Model that generates the quiz |
| `COMMIT_QUIZ_LANG` | system locale | Quiz and UI language: `en` or `es` |
| `COMMIT_QUIZ_TIMEOUT_MS` | `90000` | LLM call timeout |

The quiz and all messages are available in **English and Spanish**: the
language comes from `COMMIT_QUIZ_LANG`, falling back to the system locale
(`LC_ALL` / `LANG` starting with `es` → Spanish, anything else → English).

It also skips itself on merges, rebases and cherry-picks in progress, and on
commits below `COMMIT_QUIZ_MIN_LINES` changed lines (lockfiles, snapshots and
SVGs do not count).

## Known limitations (it is a prototype)

- `git commit --no-verify` skips it, like any hook. The goal is culture, not
  security.
- Each quiz is one LLM call: ~5–15 s of latency and some cost per commit.
  Hence the line threshold and the cheap default model.
- Statements are only as good as the diff: huge diffs are truncated to ~30 KB
  and the quiz may fall short.
