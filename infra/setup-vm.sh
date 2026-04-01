#!/bin/bash
# VM bootstrap script (W1)
# Installs Docker, Node.js, and Gemini CLI on Ubuntu 24.04

set -euo pipefail

echo "=== Gemini CLI Service: VM Setup ==="

# Update system
apt-get update && apt-get upgrade -y

# Install Docker Engine
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Install Docker Compose v2 plugin
apt-get install -y docker-compose-plugin

# Install Node.js 22 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Install Gemini CLI
npm install -g @anthropic-ai/gemini-cli

# Pin CLI version
PINNED_VERSION=$(gemini --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo "unknown")
echo "$PINNED_VERSION" > /etc/gemini-cli-version
echo "Pinned CLI version: $PINNED_VERSION"

# Create daemon user
useradd -r -m -s /bin/bash gemini-daemon
usermod -aG docker gemini-daemon

# Create data directories
mkdir -p /opt/gemini-cli-service/data/{sessions,db}
chown -R gemini-daemon:gemini-daemon /opt/gemini-cli-service

# Create systemd service
cat > /etc/systemd/system/gemini-daemon.service << 'EOF'
[Unit]
Description=Gemini CLI Daemon
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=gemini-daemon
WorkingDirectory=/opt/gemini-cli-service
ExecStart=/usr/bin/node src/daemon/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3100
Environment=SESSION_DIR=/opt/gemini-cli-service/data/sessions
Environment=DB_PATH=/opt/gemini-cli-service/data/registry.db

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable gemini-daemon

echo "=== VM setup complete ==="
echo "Deploy application code to /opt/gemini-cli-service and run: systemctl start gemini-daemon"
