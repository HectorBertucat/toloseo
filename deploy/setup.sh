#!/bin/bash
set -euo pipefail

# First-time VPS setup for Toloseo
# Run as root on a fresh Ubuntu 24.04 server

echo "=== Toloseo VPS Setup ==="

# Create deploy user
if ! id deploy &>/dev/null; then
  useradd -m -s /bin/bash deploy
  mkdir -p /home/deploy/.ssh
  cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
  chown -R deploy:deploy /home/deploy/.ssh
  chmod 700 /home/deploy/.ssh
  chmod 600 /home/deploy/.ssh/authorized_keys
  echo "deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart toloseo, /bin/systemctl status toloseo, /bin/systemctl stop toloseo, /bin/systemctl start toloseo" > /etc/sudoers.d/deploy
  echo "Created deploy user"
fi

# Install Bun
if ! command -v bun &>/dev/null; then
  curl -fsSL https://bun.sh/install | bash
  ln -sf /root/.bun/bin/bun /usr/local/bin/bun
  echo "Installed Bun"
fi

# Install Caddy
if ! command -v caddy &>/dev/null; then
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
  echo "Installed Caddy"
fi

# Create app directory
mkdir -p /opt/toloseo/server/data
mkdir -p /opt/toloseo/web/dist
chown -R deploy:deploy /opt/toloseo

# Install systemd service
cp /opt/toloseo/deploy/toloseo.service /etc/systemd/system/toloseo.service
systemctl daemon-reload
systemctl enable toloseo

# Configure Caddy
cp /opt/toloseo/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl restart caddy

# Setup UFW
ufw --force enable
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
bash /opt/toloseo/deploy/ufw-cloudflare.sh

echo "=== Setup complete ==="
echo "Next steps:"
echo "1. Configure DNS (Cloudflare CNAME → VPS IP)"
echo "2. Update DOMAIN env var in Caddyfile"
echo "3. Deploy the app via GitHub Actions"
