# CLI Version Upgrade Playbook

## Overview

The system depends on specific Gemini CLI behaviors that are not formally stable APIs. This playbook describes how to safely upgrade the CLI version.

## Critical Dependency

The flag combination `-p` + `--resume` + `--output-format stream-json` is the single most important CLI behavior. If any of these flags change or break, the architecture breaks.

**Known issue:** [#14180](https://github.com/google-gemini/gemini-cli/issues/14180) — stdin/positional args don't work with `--resume`, but `-p` flag does.

## Pre-Upgrade Checklist

- [ ] New CLI version available and release notes reviewed
- [ ] No breaking changes to: `-p`, `--resume`, `--output-format stream-json`, `--yolo`
- [ ] No changes to stream-json event schema (7 types)
- [ ] No changes to MCP integration format
- [ ] No changes to extension loading mechanism
- [ ] No changes to session file format

## Upgrade Process

### 1. Test in Isolation

```bash
# Install new version in a test environment (NOT production)
npm install -g @anthropic-ai/gemini-cli@NEW_VERSION

# Verify version
gemini --version

# Run critical flag combination test
gemini -p "Hello" --output-format stream-json --yolo
gemini -p "Continue" --resume <session_id> --output-format stream-json --yolo
```

### 2. Run Integration Suite

```bash
# From the project root
node --test tests/integration/daemon-cli.test.js

# Run CLI compatibility job
gh workflow run ci.yml -f event=workflow_dispatch
```

### 3. Validate Event Schema

```bash
# Capture output from new CLI version
gemini -p "Build a hello world app" --output-format stream-json --yolo > /tmp/cli-output.jsonl

# Verify all events match schema
node -e "
  const fs = require('fs');
  const schema = JSON.parse(fs.readFileSync('docs/stream-json-schema.json', 'utf8'));
  const lines = fs.readFileSync('/tmp/cli-output.jsonl', 'utf8').split('\n').filter(Boolean);
  const types = new Set();
  for (const line of lines) {
    const event = JSON.parse(line);
    types.add(event.type);
    if (!event.type) console.log('MISSING TYPE:', line);
  }
  console.log('Event types found:', [...types]);
  console.log('Expected: turn_start, model_turn, tool_call, tool_result, model_response, error, result');
"
```

### 4. Test Command Classification

```bash
# Run classifier tests against new CLI
node --test tests/unit/router/classifier.test.js

# Verify new/changed slash commands
gemini -p "/help" --output-format stream-json --yolo
gemini -p "/tools" --output-format stream-json --yolo
```

### 5. Deploy

```bash
# Update pinned version
echo "NEW_VERSION" | ssh gemini-daemon "sudo tee /etc/gemini-cli-version"

# Update CLI on VM
ssh gemini-daemon "sudo npm install -g @anthropic-ai/gemini-cli@NEW_VERSION"

# Restart daemon (will verify version on startup)
ssh gemini-daemon "sudo systemctl restart gemini-daemon"

# Verify
curl https://agent.yourdomain.com/health
```

### 6. Monitor (48-hour window)

- Watch daemon logs: `journalctl -u gemini-daemon -f`
- Monitor for parse errors in stream-json adapter
- Check for unknown event types (V-04 handles gracefully)
- Verify conversations resume correctly

## Rollback

If issues are found within the 48-hour window:

```bash
# Revert CLI version
ssh gemini-daemon "sudo npm install -g @anthropic-ai/gemini-cli@OLD_VERSION"
echo "OLD_VERSION" | ssh gemini-daemon "sudo tee /etc/gemini-cli-version"
ssh gemini-daemon "sudo systemctl restart gemini-daemon"
```

Target rollback time: < 5 minutes (V-05).

## Event Schema Changes

If the new CLI version changes the stream-json format:

1. Capture new event samples in `tests/fixtures/stream-json-samples/`
2. Update `docs/stream-json-schema.json`
3. Update `src/daemon/cli/stream-parser.js` if validation logic needs changes
4. Update `src/daemon/lib/constants.js` EVENT_TYPES if new types added
5. Run full test suite
6. Deploy with extra monitoring
