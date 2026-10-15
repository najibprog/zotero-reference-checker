#!/bin/sh
# Builds zotero-reference-checker.xpi from the plugin sources
set -e
cd "$(dirname "$0")"
rm -f zotero-reference-checker.xpi
zip -r -q zotero-reference-checker.xpi manifest.json bootstrap.js prefs.js content locale -x "*.DS_Store"
echo "Built $(pwd)/zotero-reference-checker.xpi"
