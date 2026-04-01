# Deployment Runbook

## Prerequisites

- GCP project with billing enabled
- `gcloud` CLI authenticated
- `terraform` >= 1.5
- Domain with DNS managed in Google Cloud DNS
- Wildcard DNS record: `*.agent.YOUR_DOMAIN` → VM static IP

## 1. Provision Infrastructure

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your project_id, domain_suffix, etc.

terraform init
terraform plan
terraform apply
```

Note the VM IP from the output.

## 2. Configure DNS

Create a wildcard A record in your DNS zone:

```
*.agent.example.com → <VM_IP>
```

This enables `dashboard.user.agent.example.com` routing.

## 3. Deploy Daemon to VM

```bash
# SSH into the VM
gcloud compute ssh gemini-daemon --zone=us-central1-a

# Clone the repo
cd /opt
git clone https://github.com/Matt-MFG/gemini-cli-service.git gemini-cli-service
cd gemini-cli-service

# Install dependencies
npm ci --omit=dev

# Configure environment
cp .env.example .env
# Edit .env with production values:
#   DOMAIN_SUFFIX=agent.yourdomain.com
#   NODE_ENV=production

# Start the daemon
sudo systemctl start gemini-daemon
sudo systemctl status gemini-daemon

# Verify
curl http://localhost:3100/health
```

## 4. Start Traefik

```bash
cd /opt/gemini-cli-service/infra

# Set environment variables
export DOMAIN_SUFFIX=agent.yourdomain.com
export GCP_PROJECT=your-project-id
export ACME_EMAIL=admin@yourdomain.com
export GCP_SA_KEY_FILE=/path/to/sa-key.json

docker compose up -d traefik
```

## 5. Verify CLI Flag Combination (CRITICAL)

```bash
# Test headless mode
gemini -p "Hello" --output-format stream-json --yolo

# Test resume
gemini -p "What is 2+2?" --output-format stream-json --yolo
# Note the session_id from the result event
gemini -p "What did I just ask?" --resume <session_id> --output-format stream-json --yolo
```

If `-p + --resume` doesn't work, see the CLI upgrade playbook.

## 6. Deploy ADK Shim

```bash
cd src/shim
export PROJECT_ID=your-project-id
export DAEMON_URL=http://<VM_IP>:3100
./deploy.sh
```

## 7. Connect Chat Platform

Configure your Slack app / web client to point to the Agent Engine endpoint from step 6.

## Health Checks

```bash
# Daemon health
curl https://agent.yourdomain.com/health

# Daemon readiness
curl https://agent.yourdomain.com/ready

# List running apps
curl "https://agent.yourdomain.com/apps?user_id=<USER_ID>"
```

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Daemon won't start | `journalctl -u gemini-daemon -f` |
| CLI version mismatch | Compare `/etc/gemini-cli-version` with `gemini --version` |
| Traefik no routes | `docker logs gemini-traefik` — check Docker socket access |
| Apps not accessible | Verify wildcard DNS, check Traefik dashboard |
| SSE not streaming | Check `X-Accel-Buffering: no` header in reverse proxy |
