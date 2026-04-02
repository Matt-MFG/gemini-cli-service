/**
 * Application entry point — wires all modules together.
 * Phase 3: Harness pane, empty state, prompt chips.
 */
import { state, $, ensureAuth, authFetch, saveLocalState } from './state.js';
import { initMarked } from './markdown.js';
import {
  sendText, loadConversations, checkHealth, subscribeApprovals,
  addSystemMsg, updateTokens
} from './chat.js';
import {
  openPanel, loadApps, loadSkills, loadMcpServers, loadCommands,
  setupMainResizeHandle, loadLocalState, initMcpModal, initFilterButtons
} from './panels.js';
import { toggleExplorer, navigateTo } from './file-explorer.js';
import { initWorkspace, saveLayout } from './workspace.js';

// ============================================================
// EMPTY STATE / MESSAGES TOGGLE
// ============================================================
function showMessages() {
  const empty = $('empty-state');
  const msgs = $('messages');
  if (empty) empty.style.display = 'none';
  if (msgs) msgs.style.display = 'flex';
}

// ============================================================
// SIDEBAR TABS
// ============================================================
document.querySelectorAll('.sidebar-tab').forEach(tab => {
  tab.addEventListener('click', function() {
    const pane = this.dataset.pane;
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar-pane').forEach(p => p.classList.remove('active'));
    this.classList.add('active');
    const paneEl = $('pane-' + pane);
    if (paneEl) paneEl.classList.add('active');

    if (pane === 'apps') loadApps();
    else if (pane === 'harness') { loadHarnessStatus(); loadRegistryList(); }
    else if (pane === 'files') { toggleExplorer(); }
    else if (pane === 'mcp') loadMcpServers();
  });
});

// ============================================================
// SIDEBAR TOGGLE
// ============================================================
$('sidebar-toggle').addEventListener('click', () => {
  $('sidebar').classList.toggle('collapsed');
});

// ============================================================
// INPUT HANDLING
// ============================================================
$('msg-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

$('msg-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = this.value.trim();
    if (text) {
      this.value = '';
      this.style.height = 'auto';
      showMessages();
      sendText(text);
    }
  }
});

$('send-btn').addEventListener('click', () => {
  const text = $('msg-input').value.trim();
  if (text) {
    $('msg-input').value = '';
    $('msg-input').style.height = 'auto';
    showMessages();
    sendText(text);
  }
});

// ============================================================
// PROMPT CHIPS (P3-33)
// ============================================================
document.querySelectorAll('.prompt-chip').forEach(chip => {
  chip.addEventListener('click', function() {
    const text = this.dataset.prompt;
    if (text) {
      $('msg-input').value = '';
      showMessages();
      sendText(text);
    }
  });
});

// ============================================================
// CONVERSATION BAR
// ============================================================
$('conv-select').addEventListener('change', function() {
  const id = this.value;
  if (id) {
    state.conversationId = id;
    $('messages').innerHTML = '';
    showMessages();
    addSystemMsg('Switched to conversation ' + id.slice(0, 8) + '...');
    loadLocalState();
  }
});

$('new-conv').addEventListener('click', () => {
  state.conversationId = null;
  state.totalTokens = 0;
  $('messages').innerHTML = '';
  updateTokens();
  // Show empty state again
  const empty = $('empty-state');
  const msgs = $('messages');
  if (empty) empty.style.display = '';
  if (msgs) msgs.style.display = 'none';
  loadConversations();
});

// ============================================================
// A2UI SELECTION EVENT
// ============================================================
document.addEventListener('a2ui-selection', e => {
  showMessages();
  sendText(e.detail);
});

// ============================================================
// HARNESS PANE
// ============================================================
async function loadHarnessStatus() {
  const container = $('harness-status');
  if (!container) return;

  try {
    const r = await authFetch('/harness/status');
    const d = await r.json();

    if (!d.running) {
      container.innerHTML = '<div class="empty-state">Infrastructure not running.</div>';
      return;
    }

    container.innerHTML = '';
    const services = d.services || {};
    for (const [name, svc] of Object.entries(services)) {
      const row = document.createElement('div');
      row.className = 'harness-svc-row';
      const dot = document.createElement('span');
      dot.className = 'status-dot ' + (svc.state === 'running' ? 'running' : 'stopped');
      const nameEl = document.createElement('span');
      nameEl.className = 'svc-name';
      nameEl.textContent = name;
      const stateEl = document.createElement('span');
      stateEl.className = 'svc-state';
      stateEl.textContent = svc.health || svc.state || '';
      row.appendChild(dot);
      row.appendChild(nameEl);
      row.appendChild(stateEl);
      container.appendChild(row);
    }
  } catch {
    container.innerHTML = '<div class="empty-state">Cannot reach harness.</div>';
  }
}

async function loadRegistryList() {
  const container = $('registry-list');
  if (!container) return;

  try {
    const r = await authFetch('/registry/apps');
    const d = await r.json();

    container.innerHTML = '';
    for (const app of (d.apps || [])) {
      const card = document.createElement('div');
      card.className = 'registry-card';
      card.innerHTML = `
        <div class="reg-name">${app.displayName || app.name}</div>
        <div class="reg-desc">${app.description || ''}</div>
        <span class="reg-category">${app.category || ''}</span>
      `;
      card.addEventListener('click', () => {
        showMessages();
        sendText(`Install ${app.name}`);
      });
      container.appendChild(card);
    }
  } catch {
    container.innerHTML = '<div class="empty-state">Registry unavailable.</div>';
  }
}

// Harness start/stop buttons
const startBtn = $('harness-start-btn');
const stopBtn = $('harness-stop-btn');
if (startBtn) {
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    startBtn.textContent = 'Starting...';
    try {
      await authFetch('/harness/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await loadHarnessStatus();
    } catch(e) { addSystemMsg('Harness start failed: ' + e.message); }
    startBtn.disabled = false;
    startBtn.textContent = 'Start';
  });
}
if (stopBtn) {
  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    try {
      await authFetch('/harness/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await loadHarnessStatus();
    } catch(e) { addSystemMsg('Harness stop failed: ' + e.message); }
    stopBtn.disabled = false;
  });
}

// ============================================================
// FILE EXPLORER
// ============================================================
const explorerClose = $('explorer-close');
if (explorerClose) {
  explorerClose.addEventListener('click', toggleExplorer);
}

// ============================================================
// INIT
// ============================================================
(async () => {
  const authed = await ensureAuth();
  if (!authed) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-muted);">API key required. Refresh to try again.</div>';
    return;
  }
  initMarked();
  initMcpModal();
  initFilterButtons();
  checkHealth();
  setInterval(checkHealth, 30000);
  loadConversations();
  loadApps();
  setInterval(loadApps, 15000);
  subscribeApprovals();
  setupMainResizeHandle();
  loadLocalState();
  initWorkspace();
})();
