#!/bin/bash
set -euo pipefail

# Allow only Cloudflare IPs on HTTP/HTTPS ports
echo "Fetching Cloudflare IP ranges..."

for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  ufw allow from "$ip" to any port 80,443 proto tcp comment "Cloudflare IPv4"
done

for ip in $(curl -s https://www.cloudflare.com/ips-v6); do
  ufw allow from "$ip" to any port 80,443 proto tcp comment "Cloudflare IPv6"
done

# Deny all other HTTP/HTTPS traffic
ufw deny 80/tcp comment "Block non-Cloudflare HTTP"
ufw deny 443/tcp comment "Block non-Cloudflare HTTPS"

echo "Cloudflare-only firewall rules applied."
