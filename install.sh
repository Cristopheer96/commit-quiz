#!/usr/bin/env sh
# Installs commit-quiz as a pre-commit hook in a target repo.
# Usage: ./install.sh /path/to/repo
set -e

TARGET="${1:?Usage: ./install.sh /path/to/repo}"
QUIZ="$(cd "$(dirname "$0")" && pwd)/bin/commit-quiz.mjs"

if [ ! -d "$TARGET/.git" ]; then
  echo "❌ $TARGET does not look like a git repo." >&2
  exit 1
fi

# If the repo uses husky, hook in there; otherwise use the classic git hook.
if [ -d "$TARGET/.husky" ]; then
  HOOK="$TARGET/.husky/pre-commit"
else
  HOOK="$TARGET/.git/hooks/pre-commit"
fi

[ -f "$HOOK" ] || printf '#!/usr/bin/env sh\n' > "$HOOK"

if grep -q 'commit-quiz' "$HOOK"; then
  echo "✅ commit-quiz was already installed in $HOOK"
  exit 0
fi

# Prefer the global command (npm install -g); fall back to this copy's path.
if command -v commit-quiz >/dev/null 2>&1; then
  RUN="commit-quiz"
else
  RUN="node \"$QUIZ\""
fi

cat >> "$HOOK" <<EOF

# >>> commit-quiz >>>
$RUN || exit 1
# <<< commit-quiz <<<
EOF
chmod +x "$HOOK"
echo "✅ commit-quiz installed in $HOOK"
echo "   To remove it: delete the block between the commit-quiz markers."
