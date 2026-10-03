#!/usr/bin/env bash
# Keep the DuckDNS record pointed at this VM's current public IP (TDD §4.3).
# Configure via env (or /etc/holocast/holocast.env): DUCKDNS_DOMAIN (subdomain only,
# e.g. "holocast"), DUCKDNS_TOKEN. Install as a cron entry every 5 minutes:
#   */5 * * * * /opt/holocast/infra/duckdns-update.sh >> /var/log/duckdns.log 2>&1
set -euo pipefail

ENV_FILE="/etc/holocast/holocast.env"
[[ -f "$ENV_FILE" ]] && { set -a; source "$ENV_FILE"; set +a; }

: "${DUCKDNS_DOMAIN:?set DUCKDNS_DOMAIN (subdomain only)}"
: "${DUCKDNS_TOKEN:?set DUCKDNS_TOKEN}"

resp=$(curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=")
echo "$(date -u +%FT%TZ) duckdns: ${resp}"
[[ "$resp" == "OK" ]] || exit 1
