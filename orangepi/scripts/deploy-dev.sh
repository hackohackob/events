#!/usr/bin/env bash
#
# Push the working tree straight onto a box on the bench, for development.
# Not the update path for deployed boxes — that is the bundle in delivery.md.
#
#     ./scripts/deploy-dev.sh 192.168.1.42
set -euo pipefail

HOST="${1:?usage: deploy-dev.sh <box-address> [user]}"
USER_NAME="${2:-root}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "▸ Building"
npm run build

echo "▸ Copying to $USER_NAME@$HOST"
ssh "$USER_NAME@$HOST" 'mkdir -p /opt/em-gateway/current'
rsync -az --delete dist public package.json "$USER_NAME@$HOST:/opt/em-gateway/current/"
rsync -az node_modules "$USER_NAME@$HOST:/opt/em-gateway/current/"

echo "▸ Restarting"
ssh "$USER_NAME@$HOST" 'systemctl restart em-gateway && sleep 2 && systemctl is-active em-gateway'
echo "  Done. Logs: ssh $USER_NAME@$HOST journalctl -u em-gateway -f"
