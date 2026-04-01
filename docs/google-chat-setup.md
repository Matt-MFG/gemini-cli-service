# Google Chat Integration Setup

## Overview

The daemon exposes a webhook endpoint at `/chat/google` that Google Chat sends messages to. Each Google Chat thread maps to a separate conversation with independent context.

## Prerequisites

- GCP project with Google Chat API enabled
- Daemon running and accessible from the internet (port 3100)
- Service account with Chat Bot scope (for sending async replies)

## 1. Enable the Chat API

```bash
gcloud services enable chat.googleapis.com --project=mfg-open-apps
```

## 2. Create a Google Chat App

1. Go to [Google Cloud Console > APIs & Services > Google Chat API](https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat)
2. Click **Configuration** tab
3. Fill in:
   - **App name:** Gemini CLI
   - **Avatar URL:** (optional)
   - **Description:** Chat with Gemini CLI — build and run apps from Google Chat
   - **Functionality:** Check "Receive 1:1 messages" and "Join spaces and group conversations"
   - **Connection settings:** Select **HTTP endpoint URL**
   - **HTTP endpoint URL:** `http://YOUR_VM_IP:3100/chat/google`
   - **Authentication Audience:** Select "HTTP endpoint URL"
   - **Visibility:** Make available to specific people or your domain
4. Click **Save**

## 3. Service Account Permissions

The daemon needs permission to send messages back to Google Chat (for async replies after CLI processing):

```bash
# The default compute service account should work if you used --scopes=cloud-platform
# Otherwise, grant the Chat Bot role:
gcloud projects add-iam-policy-binding mfg-open-apps \
  --member="serviceAccount:YOUR_SA@mfg-open-apps.iam.gserviceaccount.com" \
  --role="roles/chat.bot"
```

## 4. Test the Integration

1. Open Google Chat
2. Search for "Gemini CLI" (or whatever you named the app)
3. Start a direct message
4. Send: "Hello, what can you do?"
5. You should see a "Processing..." card, then the response

## How It Works

### Message Flow

```
User types in Google Chat
  → Google POSTs to /chat/google
  → Daemon responds immediately with "Processing..." card
  → Daemon spawns CLI async (same as web UI)
  → CLI processes message, calls MCP tools if needed
  → Daemon sends response back to Google Chat via Chat API
  → User sees response card with content + tool calls + token stats
```

### Thread = Conversation

Each Google Chat thread maps to a separate conversation. Starting a new thread starts a new conversation with fresh context. Replies in the same thread continue the same conversation with `--resume`.

### Card Format

Responses are formatted as Google Chat cards with:
- **Tools Used** section — shows which tools the agent called
- **Content** section — the agent's text response
- **Stats** footer — token count and response time

### Supported Commands

All the same commands work as in the web UI:
- Regular messages → forwarded to CLI
- `/memory add ...` → saves persistent memory
- `/stats` → shows usage statistics
- `::list` → lists conversations
- `::costs` → shows token usage
- `::apps` → lists running applications

### Unsupported Commands

Terminal-specific commands (`/clear`, `/theme`, `/settings`) return an explanation.

## Security Notes

- The `/chat/google` endpoint is exempt from API key auth — Google Chat handles its own authentication via bearer tokens
- **Important:** In production, verify the Google Chat bearer token in incoming requests. The current implementation trusts all requests to `/chat/google`. Add token verification before deploying to production.
- Each user is identified by their Google email (sanitized as user ID)
- Users can only see their own conversations and apps

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Processing..." card but no response | Check daemon logs (`/tmp/daemon.log`), verify Chat API permissions |
| "Failed to send Google Chat response" in logs | Service account missing `roles/chat.bot` permission |
| Bot not appearing in Google Chat | Check Chat API configuration, ensure visibility is set correctly |
| Responses truncated | Google Chat has a 4000-character limit per text paragraph; content is auto-truncated |
| Thread context not preserved | Ensure Google Chat is set to reply in threads, not flat messages |
