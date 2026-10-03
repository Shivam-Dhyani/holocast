#!/usr/bin/env bash
# Holocast VM provisioning (TDD §4.5). Idempotent where practical. Run as a sudoer
# on Ubuntu 24.04 (aarch64). Reads HOLOCAST_DOMAIN from the environment or
# /etc/holocast/holocast.env. This configures the box; it does not deploy the app
# (use deploy.sh for that).
set -euo pipefail

HOLOCAST_USER="holocast"
APP_DIR="/opt/holocast"
ENV_FILE="/etc/holocast/holocast.env"
SPOOL_DIR="/var/lib/holocast/spool"
TG_SESSION_DIR="/var/lib/holocast/tg-sessions"
NODE_MAJOR="22"

log() { echo -e "\n=== $* ==="; }

log "System packages"
sudo apt-get update -y
sudo apt-get install -y build-essential cmake git curl ca-certificates gnupg ffmpeg redis-server

log "Redis: bind localhost, 256mb, noeviction (BullMQ requires noeviction)"
sudo sed -i 's/^#\? *bind .*/bind 127.0.0.1 -::1/' /etc/redis/redis.conf || true
sudo sed -i 's/^#\? *maxmemory .*/maxmemory 256mb/' /etc/redis/redis.conf || true
if grep -q '^maxmemory-policy' /etc/redis/redis.conf; then
  sudo sed -i 's/^maxmemory-policy .*/maxmemory-policy noeviction/' /etc/redis/redis.conf
else
  echo 'maxmemory-policy noeviction' | sudo tee -a /etc/redis/redis.conf >/dev/null
fi
sudo systemctl enable --now redis-server
sudo systemctl restart redis-server

log "Node.js ${NODE_MAJOR} LTS + pnpm (corepack)"
if ! command -v node >/dev/null || [[ "$(node -v)" != v${NODE_MAJOR}* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo corepack enable

log "Caddy (official apt repo)"
if ! command -v caddy >/dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

log "Open ports 80/443 in iptables (OCI Ubuntu images block them)"
sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save

log "App user and directories"
id -u "$HOLOCAST_USER" >/dev/null 2>&1 || sudo useradd --system --create-home --shell /usr/sbin/nologin "$HOLOCAST_USER"
sudo mkdir -p "$APP_DIR" "$SPOOL_DIR" "$TG_SESSION_DIR" /etc/holocast
sudo chown -R "$HOLOCAST_USER:$HOLOCAST_USER" /var/lib/holocast "$APP_DIR"
sudo chmod 700 "$SPOOL_DIR" "$TG_SESSION_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "# Fill from .env.example (mode 600)" | sudo tee "$ENV_FILE" >/dev/null
  sudo chmod 600 "$ENV_FILE"
  echo "NOTE: created $ENV_FILE — fill it from the repo's .env.example before deploying."
fi

log "Caddy config"
sudo cp "$(dirname "$0")/Caddyfile" /etc/caddy/Caddyfile
if [[ -f "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a; fi
sudo systemctl enable caddy
sudo systemctl restart caddy || echo "Caddy restart deferred until HOLOCAST_DOMAIN is set and DNS points here."

log "systemd units"
sudo cp "$(dirname "$0")/systemd/"*.service /etc/systemd/system/
sudo systemctl daemon-reload

log "whisper.cpp (T-TRN-01 benchmark, base multilingual model)"
if [[ ! -d /opt/whisper.cpp ]]; then
  sudo git clone --depth 1 https://github.com/ggml-org/whisper.cpp /opt/whisper.cpp
  sudo cmake -S /opt/whisper.cpp -B /opt/whisper.cpp/build
  sudo cmake --build /opt/whisper.cpp/build -j --config Release
  sudo bash /opt/whisper.cpp/models/download-ggml-model.sh base
fi

log "Done. Next: fill $ENV_FILE, point DuckDNS at this IP, then run infra/deploy.sh"
