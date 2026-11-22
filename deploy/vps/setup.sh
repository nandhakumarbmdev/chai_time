#!/usr/bin/env bash
# Sets up the Chai Time backend + dev agent on a fresh Ubuntu/Debian VPS.
# Run as root:  sudo ./setup.sh [domain]
#   domain  optional, e.g. agent.example.com (DNS A record must already point here).
#           Installs Caddy to serve it over HTTPS with an automatic certificate.
# Safe to re-run: existing config is kept.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/nandhakumarbmdev/chai_time.git}"
APP_DIR=/opt/chai_time
ENV_FILE=/etc/chai-dev-agent.env
DOMAIN="${1:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }

echo "==> Packages"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg openssl
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code

echo "==> Service user and code"
id chai >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin chai
if [ -d "$APP_DIR/.git" ]; then
  sudo -u chai git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
  chown -R chai:chai "$APP_DIR"
fi
sudo -u chai bash -c "cd $APP_DIR && npm ci --omit=dev --no-audit --no-fund"

echo "==> Config"
if [ ! -f "$ENV_FILE" ]; then
  install -m 600 -o root -g root "$HERE/env.example" "$ENV_FILE"
fi
if grep -q '^ADMIN_KEY=$' "$ENV_FILE"; then
  KEY="$(openssl rand -hex 16)"
  sed -i "s/^ADMIN_KEY=$/ADMIN_KEY=$KEY/" "$ENV_FILE"
  echo "    Generated ADMIN_KEY: $KEY   (also stored in $ENV_FILE)"
fi

echo "==> systemd"
install -m 644 "$HERE/chai-dev-agent.service" /etc/systemd/system/chai-dev-agent.service
systemctl daemon-reload
systemctl enable chai-dev-agent >/dev/null

if [ -n "$DOMAIN" ]; then
  echo "==> HTTPS via Caddy for $DOMAIN"
  if ! command -v caddy >/dev/null; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
  fi
  printf '%s {\n    reverse_proxy localhost:4000\n}\n' "$DOMAIN" > /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
fi

# Start only once the secrets have been filled in
missing=""
for v in MONGODB_URI ANTHROPIC_API_KEY GITHUB_TOKEN; do
  grep -q "^$v=.\+" "$ENV_FILE" || missing="$missing $v"
done
if [ -n "$missing" ]; then
  echo
  echo "Almost done. Fill in these in $ENV_FILE:$missing"
  echo "Then run: sudo systemctl restart chai-dev-agent"
else
  systemctl restart chai-dev-agent
  echo "Started. Check: systemctl status chai-dev-agent"
fi
