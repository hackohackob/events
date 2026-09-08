#!/usr/bin/env bash
#
# First-time provisioning for an Orange Pi Zero 3 running Armbian.
#
# Run once on a fresh card, as root:
#
#     sudo ./scripts/install.sh
#
# It is safe to run again: every step checks before it changes anything, so it
# doubles as a repair tool for a box that has drifted.
set -euo pipefail

INSTALL_ROOT=/opt/em-gateway
STATE_DIR=/var/lib/em-gateway
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$1"; }
ok() { printf '\033[1;32m  ✓ %s\033[0m\n' "$1"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo." >&2
  exit 1
fi

# ── Packages ─────────────────────────────────────────────────────────────────
# ffmpeg must be the build with libopus: without it the box can still record,
# but it cannot encode what it hears into the format the platform stores.
say "Installing packages"
apt-get update -qq
apt-get install -y --no-install-recommends \
  nodejs npm ffmpeg alsa-utils network-manager gpiod curl ca-certificates tar
ok "packages installed"

NODE_MAJOR="$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0)"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  say "Node $NODE_MAJOR is too old — installing Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
ok "node $(node -v)"

if ! ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libopus; then
  warn "this ffmpeg has no libopus encoder — recordings cannot be uploaded."
  warn "install an ffmpeg built with libopus before going live."
fi

# ── NetworkManager ───────────────────────────────────────────────────────────
# Armbian sometimes ships with systemd-networkd or netplan in charge of wlan0,
# and nmcli then refuses to manage it — which breaks both the access point and
# joining a venue's WiFi.
say "Checking NetworkManager owns the WiFi"
systemctl enable --now NetworkManager >/dev/null 2>&1 || true
if nmcli -t -f DEVICE,STATE device status 2>/dev/null | grep -q '^wlan0:unmanaged'; then
  warn "wlan0 is unmanaged. Removing the conflicting config."
  rm -f /etc/network/interfaces.d/wlan0 || true
  sed -i 's/^managed=false/managed=true/' /etc/NetworkManager/NetworkManager.conf 2>/dev/null || true
  systemctl restart NetworkManager
  sleep 3
fi
nmcli -t -f DEVICE,TYPE,STATE device status | grep wifi || warn "no WiFi device found"

# ── Captive portal + udev ────────────────────────────────────────────────────
say "Installing the captive portal and device rules"
install -D -m 644 "$SOURCE_DIR/provisioning/captive-portal.conf" \
  /etc/NetworkManager/dnsmasq-shared.d/captive-portal.conf
install -D -m 644 "$SOURCE_DIR/provisioning/99-em-gateway-hidraw.rules" \
  /etc/udev/rules.d/99-em-gateway-hidraw.rules
udevadm control --reload-rules || true
ok "the console will open by itself when a phone joins the box's WiFi"

# ── Application ──────────────────────────────────────────────────────────────
say "Installing the gateway"
VERSION="$(node -p "require('$SOURCE_DIR/package.json').version")"
TARGET="$INSTALL_ROOT/releases/$VERSION"
mkdir -p "$TARGET" "$STATE_DIR"

if [[ ! -d "$SOURCE_DIR/dist" || ! -d "$SOURCE_DIR/public" ]]; then
  echo "This tree has not been built. Run 'npm run build' on a laptop, or use a release bundle." >&2
  exit 1
fi

cp -r "$SOURCE_DIR/dist" "$SOURCE_DIR/public" "$SOURCE_DIR/package.json" "$TARGET/"
cp -r "$SOURCE_DIR/node_modules" "$TARGET/" 2>/dev/null || \
  (cd "$TARGET" && npm install --omit=dev --no-audit --no-fund)
ln -sfn "releases/$VERSION" "$INSTALL_ROOT/current"
ok "installed $VERSION to $TARGET"

# ── Service ──────────────────────────────────────────────────────────────────
say "Setting up the service"
install -D -m 644 "$SOURCE_DIR/systemd/em-gateway.service" /etc/systemd/system/em-gateway.service
systemctl daemon-reload
systemctl enable em-gateway
systemctl restart em-gateway
sleep 2

if systemctl is-active --quiet em-gateway; then
  ok "the gateway is running"
else
  warn "the service did not start. journalctl -u em-gateway -n 50"
  exit 1
fi

cat <<EOF

  Done.

  The box is serving a WiFi network called EM-Radio-XXXX (password 12345687).
  Join it from a phone and the console opens by itself — or browse to
  http://10.42.0.1

  In the console: paste the gateway key from the dashboard, pick the venue's
  WiFi, then choose the event.

  Logs:    journalctl -u em-gateway -f
  Config:  $STATE_DIR/config.json

EOF
