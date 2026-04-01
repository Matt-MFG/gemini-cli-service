#!/bin/bash
# Deploy ADK BaseAgent shim to Google Agent Engine (W3)
set -euo pipefail

AGENT_NAME="${AGENT_NAME:-gemini-cli-shim}"
REGION="${REGION:-us-central1}"
PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID environment variable}"
DAEMON_URL="${DAEMON_URL:?Set DAEMON_URL environment variable (e.g., http://VM_IP:3100)}"

echo "=== Deploying ADK shim to Agent Engine ==="
echo "Agent: $AGENT_NAME"
echo "Region: $REGION"
echo "Daemon URL: $DAEMON_URL"

# Package the shim
cd "$(dirname "$0")"

# Create deployment package
cat > app.yaml << EOF
runtime: python312
entrypoint: agent:agent
env_variables:
  DAEMON_URL: "${DAEMON_URL}"
  SHIM_TIMEOUT_S: "660"
EOF

# Install dependencies
pip install -r requirements.txt -t lib/

# Deploy to Agent Engine
gcloud agent-engines create "$AGENT_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --source=. \
  --display-name="Gemini CLI as a Service"

echo "=== Deployment complete ==="
echo "Agent Engine endpoint ready. Configure your chat platform to point to this agent."
