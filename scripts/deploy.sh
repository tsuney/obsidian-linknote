#!/bin/bash
# ---------------------------------------------------------------------------
# Copy the plugin into an Obsidian vault so you can test it.
#
#   bash scripts/deploy.sh /path/to/vault
#   OBSIDIAN_VAULT=/path/to/vault bash scripts/deploy.sh
#
# Afterwards, run "Reload app without saving" in Obsidian.
# ---------------------------------------------------------------------------

set -euo pipefail

PLUGIN_ID="linknote"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT="${1:-${OBSIDIAN_VAULT:-}}"
DEST="$VAULT/.obsidian/plugins/$PLUGIN_ID"

if [ -z "$VAULT" ]; then
  echo "Pass the vault path as the first argument, or set OBSIDIAN_VAULT." >&2
  echo "  bash scripts/deploy.sh /path/to/vault" >&2
  exit 1
fi

if [ ! -d "$VAULT/.obsidian" ]; then
  echo "Not an Obsidian vault: $VAULT" >&2
  echo "Pass the vault path as the first argument, or set OBSIDIAN_VAULT." >&2
  exit 1
fi

mkdir -p "$DEST"
for f in main.js manifest.json styles.css; do
  cp "$REPO/$f" "$DEST/$f"
  echo "copied: $f"
done

VERSION="$(grep -o '"version"[^,]*' "$REPO/manifest.json" | head -1 | sed 's/.*: *"//; s/"//')"
echo "---"
echo "Linknote v${VERSION} -> $DEST"
echo "Run 'Reload app without saving' in Obsidian."
echo "Note: data.json in the destination is left untouched."
