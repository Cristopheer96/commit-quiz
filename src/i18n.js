// @ts-check
// User-facing copy in English and Spanish. Everything else in the codebase —
// identifiers, comments, prompts to the LLM — is English only.
// Strings are plain text; colors and layout happen in the UI layer.

export const I18N = {
  en: {
    languageName: 'English',
    failOpen: (reason) => `⚠ commit-quiz: ${reason} — allowing the commit.`,
    generating: (cli, lines) =>
      `🧠 commit-quiz · generating a quiz with ${cli} over ${lines} changed lines…`,
    notifyGenerating: '🧠 Reading your diff… the quiz opens in a few seconds.',
    quizHeader: 'Did you read your changes? Mark the TRUE statements:',
    answerPrompt: 'True ones (e.g. 1,3): ',
    dialogPrompt: 'Did you read your changes?\nSelect the TRUE statements (⌘+click to pick several):',
    passed: 'Nice — that matches your diff. Commit allowed.',
    passedShort: '✅ Commit allowed',
    failedTitle: 'That does not match your diff',
    failedIntro: 'What this diff actually changes:',
    answersLabel: 'Answers',
    trueTag: 'TRUE',
    falseTag: 'FALSE',
    reviewHint: 'Review your changes (git diff --cached) and commit again.',
    escapeHint: 'Justified escape hatch: COMMIT_QUIZ=0 git commit …',
    summaryLabel: 'Diff summary',
    statementsLabel: 'Statements',
    truncated: '\n[... diff truncated for the quiz ...]',
    debugLogAt: (file) => `commit-quiz debug log: ${file}`,
    errUnknownCli: (cli) => `COMMIT_QUIZ_CLI=${cli} is not a known provider (claude|codex|gemini)`,
    errNoCli: 'no AI CLI found on PATH (claude, codex or gemini)',
    errCallFailed: (cli, detail) => `could not call ${cli} (${detail ?? 'no detail'})`,
    errNoJson: (cli) => `the ${cli} response contained no JSON`,
    errBadJson: 'could not parse the quiz JSON',
    errBadShape: 'the quiz came back with an unexpected shape',
    errDiffFailed: (detail) => `could not read the diff (${detail})`,
    errNoPromptChannel: 'no terminal or dialog available to ask',
    installedAt: (hook) =>
      `✅ commit-quiz installed in ${hook}\n   To remove it: commit-quiz uninstall\n`,
    alreadyInstalledAt: (hook) => `✅ commit-quiz was already installed in ${hook}\n`,
    uninstalledFrom: (hook) => `✅ commit-quiz removed from ${hook}\n`,
    notInstalledIn: (target) => `commit-quiz was not installed in ${target}\n`,
    errNotARepo: (target) => `❌ ${target} does not look like a git repo.\n`,
    helpText: `commit-quiz — pre-commit comprehension quiz over the staged diff

Usage:
  commit-quiz                       run the quiz over the staged diff (pre-commit hook)
  commit-quiz install [path]        add the hook to a repo (.husky or .git/hooks)
  commit-quiz uninstall [path]      remove the hook from a repo
  commit-quiz --range A..B          quiz over a commit range instead of staged changes
  commit-quiz --diff-file <file>    quiz over a saved diff
  commit-quiz --dry-run             print the quiz with answers, ask nothing
  commit-quiz --help | --version

Configuration (env var overrides git config; git config can be --global or per repo):
  COMMIT_QUIZ=0                              skip the quiz once (escape hatch)
  COMMIT_QUIZ_MIN_LINES / commit-quiz.minlines   changed lines to trigger (default 20)
  COMMIT_QUIZ_CLI       / commit-quiz.cli        provider: claude | codex | gemini
  COMMIT_QUIZ_MODEL     / commit-quiz.model      provider model (default haiku, claude only)
  COMMIT_QUIZ_LANG      / commit-quiz.lang       language: en | es (default: system locale)
  COMMIT_QUIZ_TIMEOUT_MS / commit-quiz.timeoutms LLM timeout in ms (default 90000)
  COMMIT_QUIZ_DEBUG=1   / commit-quiz.debug      append a debug log in the temp dir
  commit-quiz.exclude (repeatable)               extra pathspecs to keep out of the quiz

Privacy: the staged diff is sent to the AI provider you configure, under your
own account. Nothing else is collected or sent anywhere. Details: README.md.
`,
  },
  es: {
    languageName: 'Spanish',
    failOpen: (reason) => `⚠ commit-quiz: ${reason} — se permite el commit.`,
    generating: (cli, lines) =>
      `🧠 commit-quiz · generando un quiz con ${cli} sobre ${lines} líneas cambiadas…`,
    notifyGenerating: '🧠 Leyendo tu diff… el quiz aparece en unos segundos.',
    quizHeader: '¿Leíste tus cambios? Marca las afirmaciones CIERTAS:',
    answerPrompt: 'Ciertas (ej: 1,3): ',
    dialogPrompt:
      '¿Leíste tus cambios?\nSelecciona las afirmaciones CIERTAS (⌘+clic para elegir varias):',
    passed: 'Bien — eso coincide con tu diff. Commit permitido.',
    passedShort: '✅ Commit permitido',
    failedTitle: 'Eso no coincide con tu diff',
    failedIntro: 'Lo que realmente cambia este diff:',
    answersLabel: 'Respuestas',
    trueTag: 'CIERTA',
    falseTag: 'FALSA',
    reviewHint: 'Revisa tus cambios (git diff --cached) y vuelve a commitear.',
    escapeHint: 'Salida de emergencia justificada: COMMIT_QUIZ=0 git commit …',
    summaryLabel: 'Resumen del diff',
    statementsLabel: 'Afirmaciones',
    truncated: '\n[... diff truncado para el quiz ...]',
    debugLogAt: (file) => `log de depuración de commit-quiz: ${file}`,
    errUnknownCli: (cli) => `COMMIT_QUIZ_CLI=${cli} no es un proveedor conocido (claude|codex|gemini)`,
    errNoCli: 'no se encontró ningún CLI de IA (claude, codex o gemini) en el PATH',
    errCallFailed: (cli, detail) => `no se pudo llamar a ${cli} (${detail ?? 'sin detalle'})`,
    errNoJson: (cli) => `la respuesta de ${cli} no trajo JSON`,
    errBadJson: 'no se pudo parsear el JSON del quiz',
    errBadShape: 'el quiz vino con forma inesperada',
    errDiffFailed: (detail) => `no se pudo leer el diff (${detail})`,
    errNoPromptChannel: 'no hay terminal ni diálogo disponible para preguntar',
    installedAt: (hook) =>
      `✅ commit-quiz instalado en ${hook}\n   Para quitarlo: commit-quiz uninstall\n`,
    alreadyInstalledAt: (hook) => `✅ commit-quiz ya estaba instalado en ${hook}\n`,
    uninstalledFrom: (hook) => `✅ commit-quiz quitado de ${hook}\n`,
    notInstalledIn: (target) => `commit-quiz no estaba instalado en ${target}\n`,
    errNotARepo: (target) => `❌ ${target} no parece un repo git.\n`,
    helpText: `commit-quiz — quiz de comprensión del diff staged antes de commitear

Uso:
  commit-quiz                       corre el quiz sobre el diff staged (hook pre-commit)
  commit-quiz install [ruta]        agrega el hook a un repo (.husky o .git/hooks)
  commit-quiz uninstall [ruta]      quita el hook de un repo
  commit-quiz --range A..B          quiz sobre un rango de commits en vez del staged
  commit-quiz --diff-file <archivo> quiz sobre un diff guardado
  commit-quiz --dry-run             imprime el quiz con respuestas, sin preguntar
  commit-quiz --help | --version

Configuración (la variable de entorno gana sobre git config; git config puede ser --global o por repo):
  COMMIT_QUIZ=0                              salta el quiz una vez (salida de emergencia)
  COMMIT_QUIZ_MIN_LINES / commit-quiz.minlines   líneas cambiadas para activarlo (default 20)
  COMMIT_QUIZ_CLI       / commit-quiz.cli        proveedor: claude | codex | gemini
  COMMIT_QUIZ_MODEL     / commit-quiz.model      modelo del proveedor (default haiku, solo claude)
  COMMIT_QUIZ_LANG      / commit-quiz.lang       idioma: en | es (default: locale del sistema)
  COMMIT_QUIZ_TIMEOUT_MS / commit-quiz.timeoutms timeout del LLM en ms (default 90000)
  COMMIT_QUIZ_DEBUG=1   / commit-quiz.debug      escribe un log de depuración en el dir temporal
  commit-quiz.exclude (repetible)                pathspecs extra a excluir del quiz

Privacidad: el diff staged se envía al proveedor de IA que configures, con tu
propia cuenta. No se recolecta ni se envía nada más. Detalles: README.md.
`,
  },
};

/**
 * Resolve the UI/quiz language: explicit env var, then git config, then the
 * system locale. git config also reaches hooks launched from editor UIs,
 * where LANG is not inherited.
 * @param {string|undefined} explicit
 * @param {string|undefined} configured
 * @param {string} locale
 */
export function pickLang(explicit, configured, locale) {
  if (explicit) return I18N[explicit] ? explicit : 'en';
  if (configured && I18N[configured]) return configured;
  return locale.toLowerCase().startsWith('es') ? 'es' : 'en';
}
