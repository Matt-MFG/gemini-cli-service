/**
 * Chat message rendering, SSE streaming, and event handling.
 * Phase 3: Turn grouping, agent presence, streaming formatting.
 */
import { state, $, escHtml, authFetch, formatTime, saveLocalState } from './state.js';
import { renderMarkdown } from './markdown.js';
import { renderA2uiPanel, detectTestPattern } from './a2ui.js';
import { openPanel, loadApps } from './panels.js';

// ============================================================
// SCROLL
// ============================================================
function scrollBottom() {
  const m = $('messages');
  m.scrollTop = m.scrollHeight;
}

// ============================================================
// AGENT PRESENCE (P3-34, P3-35, P3-36)
// ============================================================
let presenceEl = null;

function showPresence(text) {
  if (!presenceEl) {
    presenceEl = document.createElement('div');
    presenceEl.className = 'agent-presence';
    presenceEl.innerHTML = `
      <div class="thinking-indicator">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      </div>
      <span class="presence-text"></span>
    `;
    $('messages').appendChild(presenceEl);
  }
  presenceEl.querySelector('.presence-text').textContent = text || 'Thinking...';
  presenceEl.style.display = '';
  scrollBottom();
}

function updatePresence(text) {
  if (presenceEl) {
    const el = presenceEl.querySelector('.presence-text');
    el.textContent = text;
  }
}

function hidePresence() {
  if (presenceEl) {
    presenceEl.style.display = 'none';
  }
}

// ============================================================
// MESSAGE DISPLAY
// ============================================================
export function addSystemMsg(text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap system-msg';
  const inner = document.createElement('div');
  inner.className = 'msg system-text';
  inner.textContent = text;
  wrap.appendChild(inner);
  $('messages').appendChild(wrap);
  scrollBottom();
  return wrap;
}

export function addUserMsg(text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap user';
  const inner = document.createElement('div');
  inner.className = 'msg user-msg';
  inner.textContent = text;
  wrap.appendChild(inner);
  $('messages').appendChild(wrap);
  scrollBottom();
  return wrap;
}

/**
 * P3-30: Create a turn group — a single visual unit containing
 * the assistant response, tool cards, and metadata.
 */
function createTurnGroup() {
  const group = document.createElement('div');
  group.className = 'turn-group';

  const content = document.createElement('div');
  content.className = 'msg assistant-msg';

  const toolsContainer = document.createElement('div');
  toolsContainer.className = 'turn-tools';

  const meta = document.createElement('div');
  meta.className = 'msg-meta';

  group.appendChild(content);
  group.appendChild(toolsContainer);
  group.appendChild(meta);
  $('messages').appendChild(group);
  scrollBottom();

  return { group, content, toolsContainer, meta };
}

/**
 * P3-29: Tool executions as collapsible recessed surfaces.
 */
function addToolCard(container, type, title, body) {
  const card = document.createElement('div');
  card.className = 'tool-card' + (type === 'result' ? ' result' : '');

  const header = document.createElement('div');
  header.className = 'tool-card-header';

  const icon = document.createElement('span');
  icon.className = 'tool-card-icon';
  icon.textContent = type === 'use' ? '\u2699\uFE0F' : '\u2713';

  const nameEl = document.createElement('span');
  nameEl.className = 'tool-card-name';
  nameEl.textContent = title;

  const chevron = document.createElement('span');
  chevron.className = 'tool-card-chevron';
  chevron.textContent = '\u203A';

  header.appendChild(icon);
  header.appendChild(nameEl);
  header.appendChild(chevron);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'tool-card-body';
  bodyEl.textContent = body;

  header.addEventListener('click', () => card.classList.toggle('expanded'));

  card.appendChild(header);
  card.appendChild(bodyEl);
  container.appendChild(card);
  scrollBottom();
  return card;
}

export function updateTokens() {
  $('token-count').textContent = state.totalTokens ? state.totalTokens.toLocaleString() + ' tokens' : '';
}

// ============================================================
// SSE EVENT HANDLING
// ============================================================
function handleSSEEvent(ev, turn, setContent) {
  if (ev.type === 'message' && ev.role === 'assistant') {
    hidePresence();
    const content = (turn.content._rawContent || '') + (ev.content || '');
    turn.content._rawContent = content;
    // P3-31: Streaming text formatted live
    turn.content.innerHTML = renderMarkdown(content);
    // Add copy buttons to code blocks after render
    addCopyButtons(turn.content);
    setContent(content);
    scrollBottom();

  } else if (ev.type === 'tool_use') {
    // P3-35: Contextual status during tool execution
    const toolName = ev.tool_name || 'tool';
    updatePresence(getToolStatusText(toolName, ev.parameters));

    let params = '';
    try { params = JSON.stringify(ev.parameters || {}, null, 2); } catch(e) { params = '{}'; }
    addToolCard(turn.toolsContainer, 'use', toolName, params);
    checkForAppCreation(ev);

  } else if (ev.type === 'tool_result') {
    const output = String(ev.output || ev.status || '');
    addToolCard(turn.toolsContainer, 'result', (ev.tool_name || 'result') + ' result', output.slice(0, 2000));
    checkTestPatternInResult(output);
    checkForAppCreation(ev);

  } else if (ev.type === 'result' && ev.stats) {
    hidePresence();
    state.totalTokens += (ev.stats.total_tokens || 0);
    updateTokens();
    turn.meta.textContent = formatTime(ev.stats.duration_ms);
    if (ev.stats.usage) renderA2uiPanel('token_usage', ev.stats.usage, 'Token Usage');

  } else if (ev.type === 'system_warning') {
    addSystemMsg(ev.message || 'System warning');

  } else if (ev.type === 'a2ui') {
    hidePresence();
    if (ev.component === 'app_inventory') {
      const apps = (ev.rows || []).map(r => ({
        name: r[0],
        status: (r[1] || '').indexOf('Running') >= 0 ? 'running' : 'stopped',
        url: r[2], port: r[3],
      }));
      renderA2uiPanel('app_inventory', { apps }, ev.title || 'Running Applications');
    } else if (ev.component === 'stats') {
      renderA2uiPanel('token_usage', ev, ev.title || 'Token Usage');
    } else if (ev.component === 'table') {
      renderA2uiPanel('table', ev, ev.title || 'Table');
    } else if (ev.component === 'app_created') {
      addSystemMsg('App created: ' + (ev.name || '') + ' \u2014 ' + (ev.url || ''));
    } else {
      renderA2uiPanel(ev.component || ev.template || 'table', ev, ev.title || ev.label || ev.component);
    }

  } else if (ev.type === 'event') {
    const inner = ev.data || {};
    if (inner.type === 'a2ui' && inner.template) {
      renderA2uiPanel(inner.template, inner.data || {}, inner.label);
    } else if (inner.template && inner.data) {
      renderA2uiPanel(inner.template, inner.data, inner.label);
    }
  }
}

/**
 * P3-35: Human-readable tool status text.
 */
function getToolStatusText(toolName, params) {
  const p = params || {};
  if (toolName.includes('apps_create')) return `Creating app "${p.name || 'app'}"...`;
  if (toolName.includes('apps_exec')) return `Running command in ${p.name || 'container'}...`;
  if (toolName.includes('apps_list')) return 'Listing apps...';
  if (toolName.includes('apps_logs')) return `Reading logs from ${p.name || 'container'}...`;
  if (toolName.includes('read') || toolName.includes('source')) return 'Reading files...';
  if (toolName.includes('write') || toolName.includes('file')) return 'Writing files...';
  if (toolName.includes('test')) return 'Running tests...';
  return `Running ${toolName.replace(/^mcp_apps_/, '')}...`;
}

/**
 * P3-28: Add copy buttons to code blocks.
 */
function addCopyButtons(container) {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      navigator.clipboard.writeText(code ? code.textContent : pre.textContent).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    });
    pre.style.position = 'relative';
    pre.appendChild(btn);
  });
}

function checkTestPatternInResult(output) {
  if (!detectTestPattern(output)) return;
  const passing = [];
  const failing = [];

  const passMatch = output.match(/(\d+)\s+passing/);
  const failMatch = output.match(/(\d+)\s+failing/);

  output.split('\n').forEach(line => {
    const passLine = line.match(/^\s+\d+\)\s+(.+)$/) || line.match(/^\s+\u2713\s+(.+)/);
    const failLine = line.match(/^\s+\d+\)\s+(.+)\s+\(failed\)/) || line.match(/^\s+\u2717\s+(.+)/);
    if (passLine) passing.push({ name: passLine[1], status: 'pass' });
    if (failLine) failing.push({ name: failLine[1], status: 'fail' });
  });

  if (!passing.length && !failing.length) {
    if (passMatch) for (let i = 0; i < Math.min(+passMatch[1], 20); i++) passing.push({ name: 'Test ' + (i+1), status: 'pass' });
    if (failMatch) for (let j = 0; j < Math.min(+failMatch[1], 20); j++) failing.push({ name: 'Test ' + (j+1), status: 'fail' });
  }

  if (passing.length || failing.length) {
    renderA2uiPanel('test_results', { results: passing.concat(failing) }, 'Test Results');
  }
}

function checkForAppCreation(ev) {
  const toolName = ev.tool_name || '';
  if (toolName.includes('app') || toolName.includes('create')) {
    let url = null;
    let name = null;

    if (ev.parameters && typeof ev.parameters === 'object') {
      name = ev.parameters.name || ev.parameters.app_name || null;
    }

    if (ev.output && typeof ev.output === 'object') {
      url = ev.output.url || null;
      name = name || ev.output.name || ev.output.app_name || null;
    } else if (ev.output) {
      let parsed = null;
      try { parsed = JSON.parse(ev.output); } catch(e) { /* ignore */ }
      if (parsed && typeof parsed === 'object') {
        url = parsed.url || null;
        name = name || parsed.name || parsed.app_name || null;
      } else {
        const outputStr = String(ev.output);
        const urlMatch = outputStr.match(/https?:\/\/[\w.:\-/]+/);
        if (urlMatch) {
          url = urlMatch[0];
          const nameMatch = outputStr.match(/name['":\s]+([\w-]+)/i);
          name = name || (nameMatch ? nameMatch[1] : null);
        }
      }
    }

    if (url) openPanel(url, name || url, url);
  }
  setTimeout(loadApps, 1000);
}

// ============================================================
// SEND MESSAGE
// ============================================================
export async function sendText(text) {
  if (!text || state.sending) return;

  if (!state.conversationId) {
    try {
      const r = await authFetch('/conversations/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: state.userId, name: text.slice(0, 50) }),
      });
      const d = await r.json();
      state.conversationId = d.conversationId;
      loadConversations();
      saveLocalState();
    } catch(e) { addSystemMsg('Error creating conversation: ' + e.message); return; }
  }

  addUserMsg(text);
  state.sending = true;
  $('send-btn').disabled = true;

  // P3-34: Thinking indicator within 500ms
  showPresence('Thinking...');

  // P3-30: Create turn group for this response
  const turn = createTurnGroup();
  let fullContent = '';

  try {
    const resp = await authFetch('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: state.userId, conversation_id: state.conversationId, text }),
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim());
          handleSSEEvent(ev, turn, c => { fullContent = c; });
        } catch(e) { /* ignore */ }
      }
    }

    if (!fullContent) {
      turn.content.innerHTML = '<span style="color:var(--color-text-ghost);font-style:italic;">(no text response)</span>';
    }
  } catch(err) {
    turn.content.innerHTML = '<span style="color:var(--color-error);">Error: ' + escHtml(err.message) + '</span>';
  }

  hidePresence();
  state.sending = false;
  $('send-btn').disabled = false;
  $('msg-input').focus();
}

// ============================================================
// CONVERSATIONS
// ============================================================
export async function loadConversations() {
  try {
    const r = await authFetch('/conversations/list?user_id=' + state.userId);
    const d = await r.json();
    const sel = $('conv-select');
    sel.innerHTML = '<option value="">New conversation</option>';
    (d.conversations || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.conversationId;
      opt.textContent = (c.firstMessage || c.name || c.conversationId.slice(0, 8)) + ' (' + (c.turnCount || 0) + ' turns)';
      if (c.conversationId === state.conversationId) opt.selected = true;
      sel.appendChild(opt);
    });
  } catch(e) { /* ignore */ }
}

// ============================================================
// HEALTH CHECK
// ============================================================
export function checkHealth() {
  authFetch('/health').then(r => r.json()).then(d => {
    const el = $('health-status');
    el.textContent = 'v' + (d.cliVersion || '?') + ' | up ' + Math.round(d.uptime || 0) + 's';
    el.className = '';
  }).catch(() => {
    const el = $('health-status');
    el.textContent = 'Disconnected';
    el.className = 'off';
  });
}

// ============================================================
// APPROVAL GATE
// ============================================================
export function subscribeApprovals() {
  if (!state.apiKey) return;
  const es = new EventSource('/approvals/subscribe?api_key=' + encodeURIComponent(state.apiKey));
  es.addEventListener('approval_request', e => {
    try { showApprovalRequest(JSON.parse(e.data)); } catch(err) { /* ignore */ }
  });
  es.addEventListener('approved', e => {
    try { resolveApproval(JSON.parse(e.data).requestId, 'Approved'); } catch(err) { /* ignore */ }
  });
  es.addEventListener('rejected', e => {
    try { resolveApproval(JSON.parse(e.data).requestId, 'Rejected'); } catch(err) { /* ignore */ }
  });
  es.addEventListener('timeout', e => {
    try { resolveApproval(JSON.parse(e.data).requestId, 'Timed out'); } catch(err) { /* ignore */ }
  });
  es.onerror = () => { setTimeout(subscribeApprovals, 5000); };
}

function showApprovalRequest(req) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap assistant';
  wrap.id = 'approval-' + escHtml(req.requestId);

  const inner = document.createElement('div');
  inner.className = 'msg approval';
  inner.innerHTML = `
    <div><strong>Approval Required:</strong> ${escHtml(req.action)}</div>
    <div style="font-size:var(--font-size-sm);color:var(--color-text-secondary);margin-top:var(--space-1);font-family:var(--font-mono);">${escHtml(String(req.description || '').slice(0, 300))}</div>
    <div class="approval-actions">
      <button class="btn-approve" data-id="${escHtml(req.requestId)}" data-action="approve">Approve</button>
      <button class="btn-reject" data-id="${escHtml(req.requestId)}" data-action="reject">Reject</button>
    </div>
  `;

  inner.querySelector('.btn-approve').addEventListener('click', () => handleApproval(req.requestId, true));
  inner.querySelector('.btn-reject').addEventListener('click', () => handleApproval(req.requestId, false));

  wrap.appendChild(inner);
  $('messages').appendChild(wrap);
  scrollBottom();
}

function resolveApproval(requestId, status) {
  const wrap = document.getElementById('approval-' + requestId);
  if (!wrap) return;
  const actions = wrap.querySelector('.approval-actions');
  if (actions) {
    actions.innerHTML = `<span class="approval-resolved">${status}</span>`;
  }
}

async function handleApproval(requestId, approve) {
  const endpoint = approve
    ? '/approvals/' + encodeURIComponent(requestId) + '/approve'
    : '/approvals/' + encodeURIComponent(requestId) + '/reject';
  try {
    await authFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch(e) { /* ignore */ }
}
