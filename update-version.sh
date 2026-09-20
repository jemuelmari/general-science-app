#!/bin/bash
# ============================================================
# update-version.sh — Bump the app version in one command
# Usage:
#   ./update-version.sh 1.0.1
#   ./update-version.sh 1.1.0 "Added new feature"
# ============================================================

set -e

NEW_VERSION="$1"
NOTES="$2"

if [ -z "$NEW_VERSION" ]; then
  echo "❌ Usage: ./update-version.sh <version> [notes]"
  echo "   Example: ./update-version.sh 1.0.1"
  exit 1
fi

TODAY=$(date +%Y-%m-%d)

echo "🔧 Updating version to $NEW_VERSION (build $TODAY)..."

# Update VERSION file
echo "$NEW_VERSION" > VERSION
echo "   ✅ VERSION → $NEW_VERSION"

# Update config.js (VERSION + BUILD_DATE)
sed -i.bak "s/  VERSION: '[^']*'/  VERSION: '$NEW_VERSION'/" config.js
sed -i.bak "s/  BUILD_DATE: '[^']*'/  BUILD_DATE: '$TODAY'/" config.js
rm -f config.js.bak
echo "   ✅ config.js → VERSION: $NEW_VERSION, BUILD_DATE: $TODAY"

# Update README if it contains a version
if [ -f README.md ]; then
  sed -i.bak "s/\*\*Version:\*\* [0-9.]*/**Version:** $NEW_VERSION/" README.md
  rm -f README.md.bak
  echo "   ✅ README.md → $NEW_VERSION"
fi

echo ""
echo "✅ Version bumped to v$NEW_VERSION (build $TODAY)"
if [ -n "$NOTES" ]; then
  echo "   Notes: $NOTES"
fi
echo ""
echo "Next steps:"
echo "  git add ."
echo "  git commit -m \"v$NEW_VERSION — $NOTES\""
echo "  git push origin main"
