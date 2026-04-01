# Deployment Runbook

## Prerequisites

- GCP project with billing and Vertex AI API enabled
- `gcloud` CLI authenticated
- Domain (optional — nip.io works for free wildcard DNS)

## 1. Provision VM

### Option A: gcloud CLI (recommended)

```bash
# Reserve static IP
gcloud compute addresses create gemini-daemon-ip --region=us-central1

# Get the IP
gcloud compute addresses describe gemini-daemon-ip --region=us-central1 --format="value(address)"
# Example: 34.59.124.147

# Create firewall rules
gcloud compute firewall-rules create gemini-allow-http \
  --allow=tcp:80,tcp:443,tcp:3100 \
  --target-tags=gemini-daemon \
  --source-ranges=0.0.0.0/0

gcloud compute firewall-rules create gemini-allow-apps \
  --allow=tcp:8001-8100 \
  --target-tags=gemini-daemon \
  --source-ranges=0.0.0.0/0

# Create VM (e2-medium: 1 vCPU, 4GB RAM, ~$25/mo)
gcloud compute instances create gemini-daemon \
  --zone=us-central1-a \
  --machine-type=e2-medium \
  --image-family=ubuntu-2404-lts-amd64 \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-ssd \
  --tags=gemini-daemon \
  --address=gemini-daemon-ip \
  --scopes=cloud-platform
```

### Option B: Terraform

```bash
cd infra/terraform
terraform init && terraform apply
```

## 2. Install Software on VM

```bash
gcloud compute ssh gemini-daemon --zone=us-central1-a

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs

# Install Gemini CLI from source
cd /tmp
git clone --depth 1 https://github.com/google-gemini/gemini-cli.git
cd gemini-cli
npm install
sudo npm link

# Verify
gemini --version
# Expected: 0.36.0 or similar

# Fix first-run config
mkdir -p ~/.gemini
echo '{}' > ~/.gemini/projects.json
```

## 3. Deploy Daemon

```bash
# Clone the service repo
sudo mkdir -p /opt/gemini-cli-service
sudo chown $USER /opt/gemini-cli-service
cd /opt/gemini-cli-service
git clone https://github.com/Matt-MFG/gemini-cli-service.git .
npm ci --omit=dev

# Configure environment
cat > .env << 'EOF'
PORT=3100
HOST=0.0.0.0
CLI_PATH=gemini
CLI_TIMEOUT_MS=600000
CLI_MODEL=gemini-2.5-flash
SESSION_DIR=./data/sessions
DB_PATH=./data/registry.db
LOG_LEVEL=info
NODE_ENV=production
DOMAIN_SUFFIX=YOUR_IP.nip.io
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1
API_KEY=your-secret-api-key-here
EOF

# IMPORTANT: Pin CLI version (daemon refuses to start on mismatch)
echo "$(gemini --version 2>&1 | grep -oP '\d+\.\d+\.\d+[^\s]*')" > .gemini-cli-version

# Create data directories
mkdir -p data/sessions data/db

# Start daemon
nohup node src/daemon/index.js > /tmp/daemon.log 2>&1 &

# Verify
curl http://localhost:3100/health
```

## 4. Configure Gemini CLI MCP Server

This is what gives the agent the ability to create/manage Docker containers.

```bash
cat > ~/.gemini/settings.json << 'EOF'
{
  "GOOGLE_GENAI_USE_VERTEXAI": true,
  "GOOGLE_CLOUD_PROJECT": "your-gcp-project-id",
  "GOOGLE_CLOUD_LOCATION": "us-central1",
  "mcpServers": {
    "apps": {
      "command": "node",
      "args": ["/opt/gemini-cli-service/src/daemon/mcp/stdio-server.mjs"],
      "env": {
        "DAEMON_URL": "http://localhost:3100",
        "GEMINI_USER_ID": "web-user"
      }
    }
  }
}
EOF
```

### Enable Approval Mode (optional)

Add `"APPROVAL_MODE": "true"` to the env block above. When enabled, the user must approve `apps_create`, `apps_exec`, and `apps_stop` before they execute. See the [Approval Gate section in README.md](../README.md#approval-gate).

## 5. Configure Agent Guidance

This file tells the agent to use container tools instead of native file/shell tools:

```bash
cat > ~/GEMINI.md << 'EOF'
# Agent Guidance — Container-First Development

## CRITICAL RULES
1. NEVER use write_file or run_shell_command for app code — use apps_exec instead
2. ALWAYS create the container FIRST with apps_create, then write code into it with apps_exec
3. For nginx: write to /usr/share/nginx/html/index.html
4. For Node.js: write to /app/ and start with node
5. URL returned by apps_create is immediately accessible in browser
EOF
```

## 6. Verify End-to-End

```bash
# Test from outside the VM:
VM_IP=34.59.124.147
API_KEY=your-secret-api-key-here

# Create conversation
curl -s -X POST "http://$VM_IP:3100/conversations/new" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"user_id":"test","name":"E2E test"}'

# Send message (replace CONV_ID with the conversationId from above)
curl -s -N -X POST "http://$VM_IP:3100/send" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"user_id":"test","conversation_id":"CONV_ID","text":"Create an nginx app called hello on port 80 using apps_create, then use apps_exec to write Hello World HTML into it"}'
```

Or just open `http://VM_IP:3100` in your browser, enter your API key, and start chatting.

## 7. Set Up as systemd Service (optional)

```bash
sudo cat > /etc/systemd/system/gemini-daemon.service << 'EOF'
[Unit]
Description=Gemini CLI Daemon
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/opt/gemini-cli-service
ExecStart=/usr/bin/node src/daemon/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable gemini-daemon
sudo systemctl start gemini-daemon
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Daemon won't start: "CLI version mismatch" | `.gemini-cli-version` doesn't match installed CLI | `echo "$(gemini --version)" > .gemini-cli-version` |
| CLI hangs on MCP startup | Using old custom MCP server (.js) | Ensure settings.json points to `stdio-server.mjs` (the SDK version) |
| Apps created but not accessible | Firewall not open for port range | `gcloud compute firewall-rules create gemini-allow-apps --allow=tcp:8001-8100 --target-tags=gemini-daemon` |
| Agent uses write_file instead of apps_exec | Agent guidance not loaded | Ensure `~/GEMINI.md` exists with container-first rules |
| web_fetch fails with gemini-3-flash error | Model not available in Vertex AI | Non-critical; agent uses other tools. Add `"defaultModel": "gemini-2.5-flash"` to settings.json |
| Auth not working (requests pass through) | API_KEY not in .env or .env not loaded | Check `grep API_KEY .env` and restart daemon |
| Docker permission denied | User not in docker group | `sudo usermod -aG docker $USER` then re-login |
| git pull resets .gemini-cli-version | File is tracked in git | Re-set after each pull: `echo "0.36.0" > .gemini-cli-version` |

## Scaling Up

When you need more containers (10+ simultaneous apps):

```bash
# Resize VM
gcloud compute instances stop gemini-daemon --zone=us-central1-a
gcloud compute instances set-machine-type gemini-daemon \
  --zone=us-central1-a --machine-type=e2-standard-4
gcloud compute instances start gemini-daemon --zone=us-central1-a

# Extend firewall port range
gcloud compute firewall-rules update gemini-allow-apps --allow=tcp:8001-8200
```
