# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-22

### Added
- GitHub Copilot CLI provider (`copilot -s --no-ask-user -p`), selectable with
  `commit-quiz.cli copilot` and auto-detected after claude, codex and gemini.

### Fixed
- Gemini provider passed `-p` before `-m <model>`, so setting a model made
  `-p` swallow `-m` as the prompt. `-p` now comes right before the prompt.

## [0.2.0] - 2026-10-21

### Added
- `commit-quiz install [path]` and `commit-quiz uninstall [path]` subcommands.
- `--help` and `--version`.
- Per-repo configuration via `git config commit-quiz.*` (minlines, cli, model,
  lang, timeoutms, debug, exclude), with env vars as override.
- Debug log (`COMMIT_QUIZ_DEBUG=1`) in the temp dir for editor-spawned hooks.
- Native dialogs for editor-UI commits: "generating…" heads-up, quiz, and
  verdict dialog with the real diff summary on failure.
- Linux dialog support through `zenity` when installed.
- Spanish/English i18n for all user-facing copy, resolved from env, git config
  or system locale.
- Terminal colors when stderr is a real terminal.

### Changed
- Split the single script into modules under `src/` (config, i18n, diff,
  providers, terminal UI, dialogs, installer); `bin/` is a thin entry point.
- Quiz generation is ~5x faster (thinking disabled, lean prompt, no MCP
  servers loaded).
- Quiz statements are normalized to exactly 2 true + 2 false.
- Statements must be behavior-level; bookkeeping facts are banned from the
  prompt.

### Fixed
- Dialogs no longer open behind the editor window.
- Editor-spawned hooks no longer hang on an invisible terminal when the editor
  inherited a controlling tty.
- Broken stock AppleScript icons removed from dialogs.

## [0.1.0] - 2026-10-21

### Added
- Initial prototype: pre-commit hook that generates a comprehension quiz over
  the staged diff with `claude -p`, `codex exec` or `gemini -p`, asks in the
  terminal or a macOS dialog, and aborts the commit on a wrong answer.
- `install.sh`, npm packaging (`bin`), MIT license.

[Unreleased]: https://github.com/Cristopheer96/commit-quiz/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Cristopheer96/commit-quiz/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Cristopheer96/commit-quiz/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Cristopheer96/commit-quiz/releases/tag/v0.1.0
