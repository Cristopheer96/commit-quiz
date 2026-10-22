# commit-quiz

A `pre-commit` hook that verifies the developer **actually read their changes**
before committing. Useful when AI agents (Claude Code, Cursor, Codex…) generate
the code and the dev just hits "commit" without reviewing.

## How it works

1. On commit, the hook takes the staged diff (`git diff --cached`).
2. It sends it to an AI CLI you already have and generates **4 statements about
   the diff: 2 true and 2 plausible-but-false** (wrong file, inverted
   condition, different value…).
3. The dev marks which ones are true:
   - **In a terminal**: interactive prompt, with colors.
   - **From the editor UI** (VS Code, Cursor — no terminal): native dialogs
     (macOS via `osascript`, Linux via `zenity` when installed), including a
     "generating…" heads-up and a verdict dialog with the real summary when
     the answer is wrong.
4. On a correct answer the commit goes through. On a wrong one the commit is
   aborted and the **real summary** of the diff is shown.

The hook is **fail-open**: if the LLM does not respond, there is no network, or
there is no way to ask, the commit goes through with a notice. A gate that gets
in the way ends up disabled; this one only gets in the way when it can do its
job.

## Privacy

**The staged diff is sent to the AI provider you configure** (Anthropic, OpenAI
or Google), through the CLI each developer already has installed and under
their own account — there is no shared key and no middleman server.

- Nothing else is collected. commit-quiz has **zero telemetry** of its own.
- Lockfiles, snapshots and SVGs are excluded by default; add your own
  exclusions for sensitive paths:

  ```bash
  git config commit-quiz.exclude "config/secrets/**"
  git config --add commit-quiz.exclude "*.pem"
  ```

- To keep a whole commit out: `COMMIT_QUIZ=0 git commit …`.

If sending diffs to your AI provider is not acceptable in your organization,
do not install this tool.

## Requirements

- Node ≥ 18.
- Some AI CLI on the PATH: [Claude Code](https://claude.com/claude-code)
  (`claude`), OpenAI Codex CLI (`codex`) or Gemini CLI (`gemini`). The first
  one found is used, or the one set via config.
- Native dialogs: macOS out of the box; Linux needs `zenity`. Without a dialog
  backend, editor-UI commits fail open (terminal commits always work).

## Install

Once per machine:

```bash
npm install -g commit-quiz        # once published to npm
npm install -g github:Cristopheer96/commit-quiz   # meanwhile, straight from GitHub
```

Then, once per repo you want guarded:

```bash
cd /path/to/repo
commit-quiz install
```

That appends the hook line to `.husky/pre-commit` if the repo uses husky,
otherwise to `.git/hooks/pre-commit`. Idempotent. To remove it:

```bash
commit-quiz uninstall
```

Why once per repo? Git only runs hooks configured in each repository — that is
git's design, not the tool's. In husky repos the hook line is versioned, so
**one teammate commits it and the whole team gets it**; each dev only needs the
one-time `npm install -g`.

## Try it without staging anything

```bash
cd /path/to/repo
commit-quiz --range HEAD~1..HEAD --dry-run   # quiz over the last commit, answers visible
commit-quiz --range HEAD~1..HEAD             # same but interactive
commit-quiz --diff-file changes.diff --dry-run
```

## Configuration

Every option reads, in order: **environment variable → `git config` → default**.
`git config` can be per repo or `--global`, and it also reaches hooks launched
from editor UIs, where your shell environment does not.

| Env var | git config key | Default | What it does |
|---|---|---|---|
| `COMMIT_QUIZ=0` | — | — | Skips the quiz for that commit (escape hatch) |
| `COMMIT_QUIZ_MIN_LINES` | `commit-quiz.minlines` | `20` | Minimum changed lines to trigger the quiz |
| `COMMIT_QUIZ_CLI` | `commit-quiz.cli` | auto | Provider: `claude`, `codex` or `gemini` |
| `COMMIT_QUIZ_MODEL` | `commit-quiz.model` | `haiku` (claude only) | Model that generates the quiz |
| `COMMIT_QUIZ_LANG` | `commit-quiz.lang` | system locale | Quiz and UI language: `en` or `es` |
| `COMMIT_QUIZ_TIMEOUT_MS` | `commit-quiz.timeoutms` | `90000` | LLM call timeout |
| `COMMIT_QUIZ_DEBUG=1` | `commit-quiz.debug` | off | Appends a debug log in the temp dir |
| — | `commit-quiz.exclude` (repeatable) | lockfiles, `*.snap`, `*.svg` | Extra pathspecs kept out of the quiz |

The quiz and all messages are available in **English and Spanish** (adding a
language is one new entry in `src/i18n.js`). It also skips itself on merges,
rebases and cherry-picks in progress.

### Debugging

Editor-spawned hooks have no visible output. With `COMMIT_QUIZ_DEBUG=1` (or
`git config commit-quiz.debug true`) every run appends decisions and timings to
`commit-quiz-debug.log` in your temp dir.

## Platform support

| | Terminal commits | Editor-UI commits |
|---|---|---|
| macOS | ✅ | ✅ native dialogs |
| Linux | ✅ | ✅ with `zenity`, fail-open without |
| Windows | ✅ (expected; untested) | fail-open |

## Development

```
bin/commit-quiz.mjs   thin CLI entry (args + top-level flow)
src/config.js         env + git config resolution
src/i18n.js           all user-facing copy (en, es)
src/diff.js           reading the diff out of git
src/providers.js      AI CLIs (claude/codex/gemini) + quiz generation
src/ui/terminal.js    terminal prompt and rendering
src/ui/dialogs.js     native dialogs (osascript / zenity)
src/install.js        hook install/uninstall
```

No dependencies, no build step — plain Node ESM with JSDoc types. Releases are
tagged `vX.Y.Z` and published to npm by the `release.yml` workflow (requires
the `NPM_TOKEN` repo secret); see `CHANGELOG.md`.

## Known limitations

- `git commit --no-verify` skips it, like any hook. The goal is culture, not
  security.
- Each quiz is one LLM call: ~8-15 s and some cost per commit. Hence the line
  threshold, the cheap default model, and thinking disabled.
- Statements are only as good as the diff: huge diffs are truncated to ~30 KB
  and the quiz may fall short.

## License

[MIT](LICENSE)
