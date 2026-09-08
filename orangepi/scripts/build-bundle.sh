#!/usr/bin/env bash
#
# Build a release bundle the deployed boxes update themselves from.
#
#     ./scripts/build-bundle.sh            # build dist/, ui, node_modules, tar it
#
# The result is  dist-bundle/em-gateway-<version>.tar.gz  — copy that to the
# server's bundle directory (see delivery.md) and every box picks it up.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
VERSION="$(node -p "require('./package.json').version")"
OUT="dist-bundle"
STAGE="$OUT/em-gateway-$VERSION"

echo "▸ Building $VERSION"
npm run build:daemon
npm --prefix ui ci --silent 2>/dev/null || npm --prefix ui install --silent
npm run build:ui

echo "▸ Staging"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -r dist public package.json "$STAGE/"

# Production dependencies are shipped inside the bundle rather than installed on
# the box: a gateway updates itself over a venue's WiFi, and an `npm install`
# that needs the npm registry mid-race is a failure mode with no recovery.
echo "▸ Bundling production dependencies"
(cd "$STAGE" && npm install --omit=dev --no-audit --no-fund --silent)

echo "▸ Packing"
tar -czf "$OUT/em-gateway-$VERSION.tar.gz" -C "$OUT" "em-gateway-$VERSION"
rm -rf "$STAGE"

SHA="$(shasum -a 256 "$OUT/em-gateway-$VERSION.tar.gz" | cut -d' ' -f1)"
SIZE="$(wc -c < "$OUT/em-gateway-$VERSION.tar.gz" | tr -d ' ')"

cat <<EOF

  Built $OUT/em-gateway-$VERSION.tar.gz
    size    $((SIZE / 1024)) KB
    sha256  $SHA

  Publish it:
    scp $OUT/em-gateway-$VERSION.tar.gz root@<server>:/opt/events/gateway/

  The server hashes it itself, so nothing else needs to be copied. Boxes see the
  new version on their next check-in and can be updated from the dashboard, or
  they will offer it in their own console.

EOF
