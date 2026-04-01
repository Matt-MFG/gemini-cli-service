'use strict';

/**
 * Web UI route — serves a chat interface at GET /
 */
async function webRoutes(fastify) {
  fastify.get('/', async (_req, reply) => {
    reply.type('text/html').send(HTML);
  });
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gemini CLI as a Service</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#0f0f0f; color:#e0e0e0; height:100vh; display:flex; flex-direction:column; }
  header { padding:12px 20px; background:#1a1a2e; border-bottom:1px solid #333; display:flex; align-items:center; gap:12px; }
  header h1 { font-size:16px; font-weight:600; color:#7c8aff; }
  header .status { font-size:12px; color:#4a4; }
  header .status.off { color:#a44; }
  .toolbar { padding:8px 20px; background:#141420; border-bottom:1px solid #222; display:flex; gap:8px; align-items:center; font-size:13px; }
  .toolbar select, .toolbar button { background:#222; color:#ccc; border:1px solid #444; border-radius:4px; padding:4px 10px; font-size:13px; cursor:pointer; }
  .toolbar button:hover { background:#333; }
  #messages { flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:12px; }
  .msg { max-width:80%; padding:10px 14px; border-radius:10px; line-height:1.5; font-size:14px; white-space:pre-wrap; word-wrap:break-word; }
  .msg.user { align-self:flex-end; background:#2a2a5a; color:#c8c8ff; }
  .msg.assistant { align-self:flex-start; background:#1e1e2e; color:#ddd; border:1px solid #333; }
  .msg.system { align-self:center; color:#888; font-size:12px; font-style:italic; }
  .msg.tool { align-self:flex-start; background:#1a2a1a; color:#8c8; font-size:12px; border:1px solid #2a3a2a; font-family:monospace; }
  .msg .meta { font-size:11px; color:#666; margin-top:4px; }
  #input-area { padding:12px 20px; background:#1a1a2e; border-top:1px solid #333; display:flex; gap:8px; }
  #input { flex:1; background:#0f0f1f; color:#e0e0e0; border:1px solid #444; border-radius:8px; padding:10px 14px; font-size:14px; font-family:inherit; resize:none; outline:none; }
  #input:focus { border-color:#7c8aff; }
  #send { background:#4a4aff; color:#fff; border:none; border-radius:8px; padding:10px 20px; font-size:14px; cursor:pointer; font-weight:600; }
  #send:hover { background:#5c5cff; }
  #send:disabled { background:#333; cursor:not-allowed; }
</style>
</head>
<body>
<header>
  <h1>Gemini CLI as a Service</h1>
  <span id="status" class="status">Connecting...</span>
</header>
<div class="toolbar">
  <span>Conversation:</span>
  <select id="conv-select"><option value="">New conversation</option></select>
  <button id="new-conv">+ New</button>
  <span style="margin-left:auto" id="token-count"></span>
</div>
<div id="messages"></div>
<div id="input-area">
  <textarea id="input" rows="1" placeholder="Send a message..." autofocus></textarea>
  <button id="send">Send</button>
</div>
<script>
const API = location.origin;
let conversationId = null;
let userId = 'web-user';
let totalTokens = 0;
let sending = false;

const $msgs = document.getElementById('messages');
const $input = document.getElementById('input');
const $send = document.getElementById('send');
const $status = document.getElementById('status');
const $convSelect = document.getElementById('conv-select');
const $tokenCount = document.getElementById('token-count');

// Auto-resize textarea
$input.addEventListener('input', () => {
  $input.style.height = 'auto';
  $input.style.height = Math.min($input.scrollHeight, 120) + 'px';
});

// Send on Enter (Shift+Enter for newline)
$input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

$send.addEventListener('click', send);

document.getElementById('new-conv').addEventListener('click', async () => {
  conversationId = null;
  $msgs.innerHTML = '';
  addMsg('system', 'New conversation started.');
  totalTokens = 0;
  updateTokens();
  loadConversations();
});

$convSelect.addEventListener('change', () => {
  const id = $convSelect.value;
  if (id) {
    conversationId = id;
    $msgs.innerHTML = '';
    addMsg('system', 'Switched to conversation ' + id.slice(0, 8) + '...');
  }
});

async function send() {
  const text = $input.value.trim();
  if (!text || sending) return;

  // Create conversation if needed
  if (!conversationId) {
    const resp = await fetch(API + '/conversations/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, name: text.slice(0, 50) }),
    });
    const data = await resp.json();
    conversationId = data.conversationId;
    loadConversations();
  }

  addMsg('user', text);
  $input.value = '';
  $input.style.height = 'auto';
  sending = true;
  $send.disabled = true;

  const assistantEl = addMsg('assistant', '');
  let fullContent = '';

  try {
    const resp = await fetch(API + '/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, conversation_id: conversationId, text }),
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const event = JSON.parse(line.slice(5).trim());
            if (event.type === 'message' && event.role === 'assistant') {
              fullContent += event.content || '';
              assistantEl.querySelector('.text').textContent = fullContent;
              $msgs.scrollTop = $msgs.scrollHeight;
            } else if (event.type === 'tool_use') {
              addMsg('tool', '> ' + event.tool_name + '(' + JSON.stringify(event.parameters || {}).slice(0, 200) + ')');
            } else if (event.type === 'tool_result') {
              addMsg('tool', '< ' + (event.output || event.status || '').slice(0, 300));
            } else if (event.type === 'result' && event.stats) {
              totalTokens += event.stats.total_tokens || 0;
              updateTokens();
              const dur = event.stats.duration_ms;
              assistantEl.querySelector('.meta').textContent = (dur ? dur + 'ms' : '');
            }
          } catch {}
        }
      }
    }

    if (!fullContent) assistantEl.querySelector('.text').textContent = '(no text response)';

  } catch (err) {
    assistantEl.querySelector('.text').textContent = 'Error: ' + err.message;
  }

  sending = false;
  $send.disabled = false;
  $input.focus();
}

function addMsg(role, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.innerHTML = '<span class="text"></span><div class="meta"></div>';
  el.querySelector('.text').textContent = text;
  $msgs.appendChild(el);
  $msgs.scrollTop = $msgs.scrollHeight;
  return el;
}

function updateTokens() {
  $tokenCount.textContent = totalTokens ? totalTokens.toLocaleString() + ' tokens' : '';
}

async function loadConversations() {
  try {
    const resp = await fetch(API + '/conversations/list?user_id=' + userId);
    const data = await resp.json();
    $convSelect.innerHTML = '<option value="">New conversation</option>';
    for (const c of data.conversations) {
      const opt = document.createElement('option');
      opt.value = c.conversationId;
      opt.textContent = (c.firstMessage || c.name || c.conversationId.slice(0, 8)) + ' (' + c.turnCount + ' turns)';
      if (c.conversationId === conversationId) opt.selected = true;
      $convSelect.appendChild(opt);
    }
  } catch {}
}

async function checkHealth() {
  try {
    const resp = await fetch(API + '/health');
    const data = await resp.json();
    $status.textContent = 'v' + data.cliVersion + ' | up ' + data.uptime + 's';
    $status.className = 'status';
  } catch {
    $status.textContent = 'Disconnected';
    $status.className = 'status off';
  }
}

checkHealth();
setInterval(checkHealth, 30000);
loadConversations();
addMsg('system', 'Welcome to Gemini CLI as a Service. Type a message to start.');
</script>
</body>
</html>`;

module.exports = webRoutes;
