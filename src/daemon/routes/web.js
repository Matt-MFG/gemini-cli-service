'use strict';

/**
 * Web UI route — serves a chat interface with file browser at GET /
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
  .toolbar .active { background:#4a4aff; color:#fff; border-color:#4a4aff; }

  .main { flex:1; display:flex; overflow:hidden; }

  /* Chat panel */
  .chat-panel { flex:1; display:flex; flex-direction:column; min-width:0; }
  #messages { flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:12px; }
  .msg { max-width:85%; padding:10px 14px; border-radius:10px; line-height:1.5; font-size:14px; white-space:pre-wrap; word-wrap:break-word; }
  .msg.user { align-self:flex-end; background:#2a2a5a; color:#c8c8ff; }
  .msg.assistant { align-self:flex-start; background:#1e1e2e; color:#ddd; border:1px solid #333; }
  .msg.system { align-self:center; color:#888; font-size:12px; font-style:italic; }
  .msg.tool { align-self:flex-start; background:#1a2a1a; color:#8c8; font-size:12px; border:1px solid #2a3a2a; font-family:monospace; }
  .msg.approval { align-self:flex-start; background:#2a2a1a; color:#ee8; border:1px solid #444422; padding:12px; }
  .msg.approval .approval-actions { margin-top:8px; display:flex; gap:8px; }
  .msg.approval button { padding:6px 16px; border-radius:4px; cursor:pointer; font-size:13px; font-weight:600; }
  .msg.approval .btn-approve { background:#2a5a2a; color:#8f8; border:1px solid #3a6a3a; }
  .msg.approval .btn-approve:hover { background:#3a6a3a; }
  .msg.approval .btn-reject { background:#5a2a2a; color:#f88; border:1px solid #6a3a3a; }
  .msg.approval .btn-reject:hover { background:#6a3a3a; }
  .msg.approval .resolved { color:#888; font-style:italic; }
  .msg .meta { font-size:11px; color:#666; margin-top:4px; }
  #input-area { padding:12px 20px; background:#1a1a2e; border-top:1px solid #333; display:flex; gap:8px; }
  #input { flex:1; background:#0f0f1f; color:#e0e0e0; border:1px solid #444; border-radius:8px; padding:10px 14px; font-size:14px; font-family:inherit; resize:none; outline:none; }
  #input:focus { border-color:#7c8aff; }
  #send { background:#4a4aff; color:#fff; border:none; border-radius:8px; padding:10px 20px; font-size:14px; cursor:pointer; font-weight:600; }
  #send:hover { background:#5c5cff; }
  #send:disabled { background:#333; cursor:not-allowed; }

  /* File browser panel */
  .file-panel { width:400px; background:#111118; border-left:1px solid #333; display:none; flex-direction:column; }
  .file-panel.open { display:flex; }
  .file-panel .fp-header { padding:10px 14px; background:#1a1a2e; border-bottom:1px solid #333; display:flex; align-items:center; gap:8px; font-size:13px; }
  .file-panel .fp-header button { background:none; border:none; color:#888; cursor:pointer; font-size:16px; }
  .file-panel .fp-header button:hover { color:#fff; }
  .fp-path { flex:1; color:#aaa; font-family:monospace; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fp-list { flex:1; overflow-y:auto; padding:4px 0; }
  .fp-item { display:flex; align-items:center; gap:8px; padding:6px 14px; cursor:pointer; font-size:13px; }
  .fp-item:hover { background:#1a1a2e; }
  .fp-item .icon { width:16px; text-align:center; }
  .fp-item .name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fp-item .size { color:#666; font-size:11px; }
  .fp-viewer { flex:1; overflow:auto; padding:12px; display:none; }
  .fp-viewer.open { display:block; }
  .fp-viewer pre { font-family:'Cascadia Code','Fira Code',monospace; font-size:12px; line-height:1.6; color:#ccc; white-space:pre-wrap; word-wrap:break-word; }
  .fp-viewer .fv-header { display:flex; align-items:center; gap:8px; padding-bottom:8px; border-bottom:1px solid #333; margin-bottom:8px; }
  .fp-viewer .fv-name { font-weight:600; color:#7c8aff; }
  .fp-viewer .fv-size { color:#666; font-size:11px; }
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
  <button id="toggle-files">Files</button>
  <span style="margin-left:auto" id="token-count"></span>
</div>
<div class="main">
  <div class="chat-panel">
    <div id="messages"></div>
    <div id="input-area">
      <textarea id="input" rows="1" placeholder="Send a message..." autofocus></textarea>
      <button id="send">Send</button>
    </div>
  </div>
  <div id="file-panel" class="file-panel">
    <div class="fp-header">
      <button id="fp-up" title="Go up">&#8593;</button>
      <button id="fp-home" title="Home">&#8962;</button>
      <button id="fp-refresh" title="Refresh">&#8635;</button>
      <span class="fp-path" id="fp-path">/home</span>
      <button id="fp-close" title="Close">&#10005;</button>
    </div>
    <div class="fp-list" id="fp-list"></div>
    <div class="fp-viewer" id="fp-viewer">
      <div class="fv-header">
        <button id="fv-back" style="background:none;border:none;color:#888;cursor:pointer;">&#8592; Back</button>
        <span class="fv-name" id="fv-name"></span>
        <span class="fv-size" id="fv-size"></span>
      </div>
      <pre id="fv-content"></pre>
    </div>
  </div>
</div>
<script>
const API = location.origin;
let conversationId = null;
let userId = 'web-user';
let totalTokens = 0;
let sending = false;
let currentFilePath = null;
let apiKey = sessionStorage.getItem('apiKey') || '';

// Auth: prompt for API key if not set
function ensureAuth() {
  if (apiKey) return true;
  apiKey = prompt('Enter API key:');
  if (!apiKey) return false;
  sessionStorage.setItem('apiKey', apiKey);
  return true;
}

// Authenticated fetch wrapper
function authFetch(url, opts = {}) {
  if (!opts.headers) opts.headers = {};
  if (typeof opts.headers.set === 'function') opts.headers.set('X-API-Key', apiKey);
  else opts.headers['X-API-Key'] = apiKey;
  return fetch(url, opts);
}

const $ = (id) => document.getElementById(id);
const $msgs = $('messages');
const $input = $('input');
const $send = $('send');
const $status = $('status');
const $convSelect = $('conv-select');
const $tokenCount = $('token-count');
const $filePanel = $('file-panel');
const $fpList = $('fp-list');
const $fpPath = $('fp-path');
const $fpViewer = $('fp-viewer');
const $fvContent = $('fv-content');
const $fvName = $('fv-name');
const $fvSize = $('fv-size');

// --- Chat ---

$input.addEventListener('input', () => {
  $input.style.height = 'auto';
  $input.style.height = Math.min($input.scrollHeight, 120) + 'px';
});
$input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$send.addEventListener('click', send);

$('new-conv').addEventListener('click', () => {
  conversationId = null;
  $msgs.innerHTML = '';
  addMsg('system', 'New conversation started.');
  totalTokens = 0;
  updateTokens();
  loadConversations();
});

$convSelect.addEventListener('change', () => {
  const id = $convSelect.value;
  if (id) { conversationId = id; $msgs.innerHTML = ''; addMsg('system', 'Switched to conversation ' + id.slice(0,8) + '...'); }
});

async function send() {
  const text = $input.value.trim();
  if (!text || sending) return;

  if (!conversationId) {
    const resp = await authFetch(API + '/conversations/new', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, name: text.slice(0, 50) }),
    });
    const data = await resp.json();
    conversationId = data.conversationId;
    loadConversations();
  }

  addMsg('user', text);
  $input.value = ''; $input.style.height = 'auto';
  sending = true; $send.disabled = true;

  const assistantEl = addMsg('assistant', '');
  let fullContent = '';

  try {
    const resp = await authFetch(API + '/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.type === 'message' && ev.role === 'assistant') {
              fullContent += ev.content || '';
              assistantEl.querySelector('.text').textContent = fullContent;
              $msgs.scrollTop = $msgs.scrollHeight;
            } else if (ev.type === 'tool_use') {
              addMsg('tool', '> ' + ev.tool_name + '(' + JSON.stringify(ev.parameters || {}).slice(0,200) + ')');
            } else if (ev.type === 'tool_result') {
              addMsg('tool', '< ' + (ev.output || ev.status || '').slice(0,300));
              // Auto-refresh file browser after tool execution
              if ($filePanel.classList.contains('open')) loadFiles(currentFilePath);
            } else if (ev.type === 'result' && ev.stats) {
              totalTokens += ev.stats.total_tokens || 0;
              updateTokens();
              assistantEl.querySelector('.meta').textContent = (ev.stats.duration_ms || '') + 'ms';
              // Refresh files after each turn
              if ($filePanel.classList.contains('open')) loadFiles(currentFilePath);
            }
          } catch {}
        }
      }
    }
    if (!fullContent) assistantEl.querySelector('.text').textContent = '(no text response)';
  } catch (err) {
    assistantEl.querySelector('.text').textContent = 'Error: ' + err.message;
  }

  sending = false; $send.disabled = false; $input.focus();
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
    const resp = await authFetch(API + '/conversations/list?user_id=' + userId);
    const data = await resp.json();
    $convSelect.innerHTML = '<option value="">New conversation</option>';
    for (const c of data.conversations) {
      const opt = document.createElement('option');
      opt.value = c.conversationId;
      opt.textContent = (c.firstMessage || c.name || c.conversationId.slice(0,8)) + ' (' + c.turnCount + ' turns)';
      if (c.conversationId === conversationId) opt.selected = true;
      $convSelect.appendChild(opt);
    }
  } catch {}
}

async function checkHealth() {
  try {
    const resp = await authFetch(API + '/health');
    const d = await resp.json();
    $status.textContent = 'v' + d.cliVersion + ' | up ' + d.uptime + 's';
    $status.className = 'status';
  } catch {
    $status.textContent = 'Disconnected';
    $status.className = 'status off';
  }
}

// --- Approval Gate ---

function subscribeApprovals() {
  if (!apiKey) return;
  const es = new EventSource(API + '/approvals/subscribe?api_key=' + apiKey);
  es.addEventListener('approval_request', (e) => {
    const req = JSON.parse(e.data);
    showApprovalRequest(req);
  });
  es.addEventListener('approved', (e) => {
    const data = JSON.parse(e.data);
    resolveApproval(data.requestId, 'Approved');
  });
  es.addEventListener('rejected', (e) => {
    const data = JSON.parse(e.data);
    resolveApproval(data.requestId, 'Rejected');
  });
  es.addEventListener('timeout', (e) => {
    const data = JSON.parse(e.data);
    resolveApproval(data.requestId, 'Timed out');
  });
  es.onerror = () => { setTimeout(subscribeApprovals, 5000); };
}

function showApprovalRequest(req) {
  const el = document.createElement('div');
  el.className = 'msg approval';
  el.id = 'approval-' + req.requestId;
  el.innerHTML = '<div><strong>Approval Required:</strong> ' + escHtml(req.action) + '</div>' +
    '<div style="font-size:12px;color:#aaa;margin-top:4px;font-family:monospace;">' + escHtml(req.description).slice(0, 300) + '</div>' +
    '<div class="approval-actions">' +
    '<button class="btn-approve" onclick="handleApproval(\\'' + req.requestId + '\\', true)">Approve</button>' +
    '<button class="btn-reject" onclick="handleApproval(\\'' + req.requestId + '\\', false)">Reject</button>' +
    '</div>';
  $msgs.appendChild(el);
  $msgs.scrollTop = $msgs.scrollHeight;
}

function resolveApproval(requestId, status) {
  const el = document.getElementById('approval-' + requestId);
  if (!el) return;
  const actions = el.querySelector('.approval-actions');
  if (actions) actions.innerHTML = '<span class="resolved">' + status + '</span>';
}

async function handleApproval(requestId, approve) {
  const endpoint = approve ? '/approvals/' + requestId + '/approve' : '/approvals/' + requestId + '/reject';
  await authFetch(API + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}

// Make handleApproval available globally for onclick
window.handleApproval = handleApproval;

// --- File Browser ---

$('toggle-files').addEventListener('click', () => {
  $filePanel.classList.toggle('open');
  $('toggle-files').classList.toggle('active', $filePanel.classList.contains('open'));
  if ($filePanel.classList.contains('open') && !currentFilePath) loadFiles();
});
$('fp-close').addEventListener('click', () => {
  $filePanel.classList.remove('open');
  $('toggle-files').classList.remove('active');
});
$('fp-up').addEventListener('click', () => {
  if (currentFilePath) {
    const parent = currentFilePath.replace(/\\/[^\\/]+\\/?$/, '') || '/';
    loadFiles(parent);
  }
});
$('fp-home').addEventListener('click', () => loadFiles());
$('fp-refresh').addEventListener('click', () => loadFiles(currentFilePath));
$('fv-back').addEventListener('click', () => {
  $fpViewer.classList.remove('open');
  $fpList.style.display = '';
});

async function loadFiles(dirPath) {
  const url = dirPath ? API + '/files?path=' + encodeURIComponent(dirPath) : API + '/files';
  try {
    const resp = await authFetch(url);
    if (!resp.ok) { $fpList.innerHTML = '<div style="padding:14px;color:#a44;">Access denied</div>'; return; }
    const data = await resp.json();
    currentFilePath = data.path;
    $fpPath.textContent = data.path;
    $fpViewer.classList.remove('open');
    $fpList.style.display = '';

    $fpList.innerHTML = '';
    for (const item of data.items) {
      const el = document.createElement('div');
      el.className = 'fp-item';
      const icon = item.type === 'directory' ? '&#128193;' : '&#128196;';
      const size = item.size != null ? formatSize(item.size) : '';
      el.innerHTML = '<span class="icon">' + icon + '</span><span class="name">' + escHtml(item.name) + '</span><span class="size">' + size + '</span>';
      el.addEventListener('click', () => {
        if (item.type === 'directory') loadFiles(item.path);
        else viewFile(item.path);
      });
      $fpList.appendChild(el);
    }
    if (data.items.length === 0) {
      $fpList.innerHTML = '<div style="padding:14px;color:#666;">Empty directory</div>';
    }
  } catch (err) {
    $fpList.innerHTML = '<div style="padding:14px;color:#a44;">Error: ' + err.message + '</div>';
  }
}

async function viewFile(filePath) {
  try {
    const resp = await authFetch(API + '/files/read?path=' + encodeURIComponent(filePath));
    if (!resp.ok) { alert('Cannot read file'); return; }
    const data = await resp.json();
    $fvName.textContent = data.name;
    $fvSize.textContent = formatSize(data.size);
    $fvContent.textContent = data.content;
    $fpList.style.display = 'none';
    $fpViewer.classList.add('open');
  } catch (err) {
    alert('Error reading file: ' + err.message);
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Init — prompt for API key
if (!ensureAuth()) {
  document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#888;">API key required. Refresh to try again.</div>';
} else {
checkHealth();
setInterval(checkHealth, 30000);
loadConversations();
subscribeApprovals();
addMsg('system', 'Welcome to Gemini CLI as a Service. Type a message to start. Click "Files" to browse the VM filesystem.');
}
</script>
</body>
</html>`;

module.exports = webRoutes;
