#!/usr/bin/env bash
# Builds dist/testimony-<version>.zip containing only the runtime files (manifest.json at the zip root).
set -euo pipefail
cd "$(dirname "$0")"
node test/sites.test.mjs
node test/background.test.mjs >/dev/null && echo "background tests passed"
node test/tabs.test.mjs >/dev/null && echo "tab tests passed"
node test/capture.test.mjs >/dev/null && echo "capture tests passed"
node test/history.test.mjs >/dev/null && echo "history tests passed"
node test/fastclicks.test.mjs >/dev/null 2>&1 && echo "fast click tests passed"
node test/modes.test.mjs >/dev/null && echo "mode tests passed"
node test/pdf.test.mjs >/dev/null && rm -f test/out.pdf && echo "pdf test passed"
V=$(node -p "require('./manifest.json').version")
mkdir -p dist
OUT="dist/testimony-$V.zip"
rm -f "$OUT"
zip -X -r "$OUT" manifest.json background.js content.js db.js annotate.js pdf.js sites.js modes.js placeholder.js \
  popup.html popup.css popup.js editor.html editor.css editor.js icons -x '*.DS_Store' >/dev/null
echo "built $OUT"
unzip -l "$OUT"
