'use strict';

/**
 * Web UI route — serves the Phase 2 chat interface at GET /
 * Single-file SPA with dark theme, markdown rendering, A2UI panels,
 * embedded app iframes, app drawer, and skills/MCP management.
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
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/monokai-sublime.min.css">
<script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"><\/script>
<style>
/* ====== RESET & BASE ====== */
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#e0e0e0;height:100vh;display:flex;flex-direction:column;overflow:hidden;}

/* ====== TOOLBAR ====== */
header{padding:0 16px;background:#1a1a2e;border-bottom:1px solid #333;display:flex;align-items:center;gap:10px;height:44px;flex-shrink:0;}
header h1{font-size:14px;font-weight:700;color:#7c8aff;white-space:nowrap;}
.toolbar-sep{flex:1;}
#health-status{font-size:12px;color:#4a4;white-space:nowrap;}
#health-status.off{color:#a44;}
#token-count{font-size:12px;color:#888;white-space:nowrap;}
.conv-bar{padding:6px 16px;background:#141420;border-bottom:1px solid #222;display:flex;gap:8px;align-items:center;font-size:13px;flex-shrink:0;}
.conv-bar select{background:#222;color:#ccc;border:1px solid #444;border-radius:4px;padding:4px 8px;font-size:13px;cursor:pointer;max-width:260px;}
.conv-bar button{background:#222;color:#ccc;border:1px solid #444;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;}
.conv-bar button:hover{background:#333;}
.conv-bar button.active{background:#4a4aff;color:#fff;border-color:#4a4aff;}

/* ====== MAIN LAYOUT ====== */
.main{flex:1;display:grid;grid-template-columns:auto 1fr auto;overflow:hidden;min-height:0;}

/* ====== LEFT SIDEBAR ====== */
.sidebar{width:280px;background:#111118;border-right:1px solid #2a2a3a;display:flex;flex-direction:column;overflow:hidden;transition:width 0.2s;flex-shrink:0;}
.sidebar.collapsed{width:0;}
.sidebar-header{padding:8px 12px;background:#1a1a2e;border-bottom:1px solid #333;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#888;flex-shrink:0;}
.sidebar-tabs{display:flex;border-bottom:1px solid #2a2a3a;flex-shrink:0;}
.sidebar-tab{flex:1;padding:8px 4px;font-size:11px;text-align:center;cursor:pointer;color:#666;border-bottom:2px solid transparent;background:none;border-top:none;border-left:none;border-right:none;}
.sidebar-tab.active{color:#7c8aff;border-bottom-color:#7c8aff;}
.sidebar-tab:hover{color:#aaa;}
.sidebar-pane{display:none;flex:1;overflow-y:auto;flex-direction:column;}
.sidebar-pane.active{display:flex;}

/* App Drawer */
.app-filter-bar{display:flex;gap:4px;padding:8px;flex-shrink:0;}
.app-filter-btn{font-size:11px;padding:3px 8px;border-radius:3px;border:1px solid #333;background:#1a1a2e;color:#888;cursor:pointer;}
.app-filter-btn.active{background:#7c8aff22;color:#7c8aff;border-color:#7c8aff55;}
.app-card{padding:8px 12px;border-bottom:1px solid #1e1e2e;cursor:pointer;position:relative;}
.app-card:hover{background:#1a1a2e;}
.app-card .app-name{font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;}
.app-card .app-url{font-size:11px;color:#7c8aff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;}
.app-card .app-meta{font-size:10px;color:#666;margin-top:2px;}
.status-dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex-shrink:0;}
.status-dot.running{background:#4a4;}
.status-dot.stopped{background:#666;}
.status-dot.error{background:#a44;}
.app-group-header{padding:6px 12px;font-size:11px;color:#666;background:#0f0f18;cursor:pointer;user-select:none;display:flex;align-items:center;gap:4px;}
.app-group-header:hover{color:#aaa;}
.context-menu{position:fixed;background:#1e1e2e;border:1px solid #333;border-radius:6px;padding:4px 0;z-index:9999;font-size:13px;min-width:150px;box-shadow:0 4px 16px #0008;}
.context-menu-item{padding:6px 16px;cursor:pointer;color:#ccc;}
.context-menu-item:hover{background:#2a2a4a;color:#fff;}
.context-menu-sep{height:1px;background:#333;margin:4px 0;}

/* Skills / MCP / Commands */
.skill-item{padding:8px 12px;border-bottom:1px solid #1e1e2e;display:flex;align-items:center;gap:8px;}
.skill-name{flex:1;font-size:13px;}
.skill-desc{font-size:11px;color:#666;margin-top:2px;}
.toggle-switch{position:relative;width:36px;height:20px;flex-shrink:0;}
.toggle-switch input{opacity:0;width:0;height:0;}
.toggle-track{position:absolute;inset:0;background:#333;border-radius:10px;cursor:pointer;transition:background 0.2s;}
.toggle-switch input:checked + .toggle-track{background:#7c8aff;}
.toggle-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform 0.2s;}
.toggle-switch input:checked ~ .toggle-thumb{transform:translateX(16px);}
.mcp-item{padding:8px 12px;border-bottom:1px solid #1e1e2e;}
.mcp-item .mcp-name{font-size:13px;display:flex;align-items:center;gap:6px;}
.mcp-item .mcp-tools{font-size:11px;color:#666;margin-top:2px;}
.mcp-actions{display:flex;gap:4px;margin-top:6px;}
.btn-sm{font-size:11px;padding:3px 8px;border-radius:3px;border:1px solid #444;background:#1a1a2e;color:#ccc;cursor:pointer;}
.btn-sm:hover{background:#2a2a4a;}
.btn-sm.danger{border-color:#6a2a2a;color:#f88;}
.btn-sm.danger:hover{background:#3a1a1a;}
.btn-add{display:block;width:calc(100% - 24px);margin:8px 12px;padding:6px;font-size:12px;background:#1a1a2e;border:1px dashed #444;border-radius:4px;color:#7c8aff;cursor:pointer;text-align:center;}
.btn-add:hover{background:#2a2a4a;}
.cmd-item{padding:8px 12px;border-bottom:1px solid #1e1e2e;font-size:13px;color:#ccc;}
.cmd-item .cmd-name{color:#7c8aff;font-family:monospace;}
.empty-state{padding:24px;text-align:center;color:#555;font-size:13px;}

/* ====== CHAT PANEL ====== */
.chat-panel{display:flex;flex-direction:column;min-width:300px;overflow:hidden;}
#messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px;min-height:0;}
.msg-wrap{display:flex;flex-direction:column;}
.msg-wrap.user{align-items:flex-end;}
.msg-wrap.assistant{align-items:flex-start;}
.msg-wrap.system-msg{align-items:center;}
.msg-wrap.tool-use-wrap{align-items:flex-start;}
.msg-wrap.tool-result-wrap{align-items:flex-start;}

.msg{max-width:85%;padding:10px 14px;border-radius:10px;font-size:14px;line-height:1.6;word-wrap:break-word;}
.msg.user-msg{background:#2a2a5a;color:#c8c8ff;white-space:pre-wrap;}
.msg.assistant-msg{background:#1e1e2e;color:#ddd;border:1px solid #333;}
.msg.system-text{color:#666;font-size:12px;font-style:italic;}
.msg.approval{background:#2a2a1a;color:#ee8;border:1px solid #444422;max-width:600px;}

/* Markdown inside assistant messages */
.msg.assistant-msg h1,.msg.assistant-msg h2,.msg.assistant-msg h3{margin:12px 0 6px;color:#c0c0ff;}
.msg.assistant-msg h1{font-size:1.3em;}
.msg.assistant-msg h2{font-size:1.15em;}
.msg.assistant-msg h3{font-size:1.05em;}
.msg.assistant-msg p{margin:6px 0;}
.msg.assistant-msg ul,.msg.assistant-msg ol{margin:6px 0 6px 20px;}
.msg.assistant-msg li{margin:2px 0;}
.msg.assistant-msg pre{margin:8px 0;border-radius:6px;overflow:auto;font-size:12px;}
.msg.assistant-msg code{font-family:'Cascadia Code','Fira Code',monospace;font-size:12px;}
.msg.assistant-msg :not(pre) > code{background:#2a2a3a;padding:1px 5px;border-radius:3px;color:#c8c8ff;}
.msg.assistant-msg table{border-collapse:collapse;width:100%;margin:8px 0;}
.msg.assistant-msg th,.msg.assistant-msg td{border:1px solid #333;padding:6px 10px;text-align:left;}
.msg.assistant-msg th{background:#1a1a2e;color:#aaa;}
.msg.assistant-msg blockquote{border-left:3px solid #7c8aff;padding-left:12px;color:#aaa;margin:8px 0;}
.msg.assistant-msg a{color:#7c8aff;}
.msg.assistant-msg hr{border:none;border-top:1px solid #333;margin:12px 0;}
.msg-meta{font-size:10px;color:#555;margin-top:4px;}

/* Tool cards */
.tool-card{max-width:90%;background:#141420;border:1px solid #2a2a3a;border-radius:8px;overflow:hidden;font-size:13px;}
.tool-card-header{padding:7px 12px;display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;background:#1a1a28;}
.tool-card-header:hover{background:#1e1e30;}
.tool-card-icon{font-size:14px;}
.tool-card-name{flex:1;font-weight:500;color:#aac;}
.tool-card-chevron{color:#555;transition:transform 0.2s;font-size:11px;}
.tool-card.expanded .tool-card-chevron{transform:rotate(90deg);}
.tool-card-body{display:none;padding:10px 12px;font-family:'Cascadia Code','Fira Code',monospace;font-size:11px;color:#8a8;border-top:1px solid #2a2a3a;overflow:auto;max-height:300px;white-space:pre-wrap;word-wrap:break-word;}
.tool-card.expanded .tool-card-body{display:block;}
.tool-card.result .tool-card-name{color:#8a8;}
.tool-card.result .tool-card-body{color:#aaa;}

/* A2UI structured panels */
.a2ui-panel{max-width:100%;margin:4px 0;background:#141420;border:1px solid #2a2a3a;border-radius:8px;overflow:hidden;font-size:13px;}
.a2ui-header{padding:8px 14px;background:#1a1a28;font-weight:600;font-size:12px;color:#aaa;display:flex;align-items:center;gap:6px;}
.a2ui-header.pass{background:#1a2e1a;color:#6a6;}
.a2ui-header.fail{background:#2e1a1a;color:#a66;}
.a2ui-body{padding:10px;}
/* test_results */
.test-table{width:100%;border-collapse:collapse;font-size:12px;}
.test-table th{text-align:left;color:#666;padding:4px 8px;border-bottom:1px solid #222;}
.test-table td{padding:5px 8px;border-bottom:1px solid #1a1a2e;}
.test-table .pass-icon{color:#4a4;}
.test-table .fail-icon{color:#a44;}
/* app_inventory */
.app-inv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;}
.app-inv-card{background:#1a1a28;border:1px solid #2a2a3a;border-radius:6px;padding:10px;}
.app-inv-card .inv-name{font-weight:500;font-size:13px;display:flex;align-items:center;gap:6px;margin-bottom:4px;}
.app-inv-card .inv-url{font-size:11px;color:#7c8aff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.app-inv-card .inv-port{font-size:10px;color:#666;margin-top:2px;}
/* selection_list */
.sel-list{list-style:none;}
.sel-list li{padding:8px 12px;cursor:pointer;border-bottom:1px solid #1e1e2e;color:#ccc;}
.sel-list li:hover{background:#2a2a4a;color:#fff;}
/* token_usage */
.token-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;}
.token-card{background:#1a1a28;border-radius:6px;padding:10px;text-align:center;}
.token-card .token-val{font-size:1.4em;font-weight:700;color:#7c8aff;}
.token-card .token-label{font-size:11px;color:#666;margin-top:3px;}
/* file_changes */
.diff-line{font-family:'Cascadia Code','Fira Code',monospace;font-size:12px;padding:1px 6px;white-space:pre-wrap;word-wrap:break-word;}
.diff-line.add{background:#1a2e1a;color:#6d6;}
.diff-line.del{background:#2e1a1a;color:#d66;}
.diff-line.ctx{color:#666;}
/* generic table */
.generic-table{width:100%;border-collapse:collapse;font-size:12px;}
.generic-table th{text-align:left;padding:6px 10px;background:#1a1a28;color:#888;border-bottom:1px solid #2a2a3a;cursor:pointer;}
.generic-table th:hover{color:#ccc;}
.generic-table td{padding:6px 10px;border-bottom:1px solid #1a1a2e;color:#ccc;}
.generic-table tr:hover td{background:#1a1a28;}

/* Widget iframes */
.widget-frame{width:100%;min-height:200px;border:none;border-radius:6px;background:#fff;margin:4px 0;display:block;}

/* ====== INPUT AREA ====== */
#input-area{padding:10px 16px;background:#1a1a2e;border-top:1px solid #333;display:flex;gap:8px;flex-shrink:0;}
#msg-input{flex:1;background:#0f0f1f;color:#e0e0e0;border:1px solid #444;border-radius:8px;padding:9px 13px;font-size:14px;font-family:inherit;resize:none;outline:none;max-height:120px;overflow-y:auto;}
#msg-input:focus{border-color:#7c8aff;}
#send-btn{background:#4a4aff;color:#fff;border:none;border-radius:8px;padding:9px 20px;font-size:14px;cursor:pointer;font-weight:600;flex-shrink:0;}
#send-btn:hover{background:#5c5cff;}
#send-btn:disabled{background:#333;cursor:not-allowed;}

/* ====== RIGHT PANEL ====== */
.right-panels{display:flex;flex-direction:column;flex-shrink:0;overflow:hidden;max-width:60vw;}
.right-panel{display:flex;flex-direction:column;background:#111118;border-left:1px solid #2a2a3a;min-width:0;}
.right-panel.closed{display:none;}
.panel-header{padding:6px 10px;background:#1a1a2e;border-bottom:1px solid #2a2a3a;display:flex;align-items:center;gap:6px;font-size:12px;flex-shrink:0;}
.panel-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#aaa;}
.panel-btn{background:none;border:none;color:#666;cursor:pointer;font-size:13px;padding:2px 4px;}
.panel-btn:hover{color:#ccc;}
.panel-iframe{flex:1;border:none;background:#fff;}
.resize-handle{width:5px;background:#2a2a3a;cursor:col-resize;flex-shrink:0;}
.resize-handle:hover,.resize-handle.dragging{background:#7c8aff44;}
.main-resize-handle{width:5px;background:#2a2a3a;cursor:col-resize;flex-shrink:0;display:none;}
.main-resize-handle.visible{display:block;}
.main-resize-handle:hover,.main-resize-handle.dragging{background:#7c8aff44;}

/* ====== APPROVAL GATE ====== */
.approval-actions{margin-top:8px;display:flex;gap:8px;}
.btn-approve{padding:6px 16px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;background:#2a5a2a;color:#8f8;border:1px solid #3a6a3a;}
.btn-approve:hover{background:#3a6a3a;}
.btn-reject{padding:6px 16px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;background:#5a2a2a;color:#f88;border:1px solid #6a3a3a;}
.btn-reject:hover{background:#6a3a3a;}
.approval-resolved{color:#888;font-style:italic;font-size:12px;}

/* ====== MODAL ====== */
.modal-backdrop{position:fixed;inset:0;background:#0008;z-index:8000;display:flex;align-items:center;justify-content:center;}
.modal-backdrop.hidden{display:none;}
.modal{background:#1a1a2e;border:1px solid #333;border-radius:10px;padding:24px;min-width:400px;max-width:560px;width:90%;}
.modal h2{font-size:16px;margin-bottom:16px;color:#c0c0ff;}
.modal label{display:block;font-size:12px;color:#888;margin-bottom:4px;margin-top:12px;}
.modal input,.modal textarea{width:100%;background:#0f0f1f;color:#e0e0e0;border:1px solid #444;border-radius:6px;padding:8px 10px;font-size:13px;font-family:inherit;outline:none;}
.modal input:focus,.modal textarea:focus{border-color:#7c8aff;}
.modal textarea{resize:vertical;min-height:70px;}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px;}
.btn-primary{padding:8px 20px;border-radius:6px;border:none;background:#4a4aff;color:#fff;font-size:13px;cursor:pointer;font-weight:600;}
.btn-primary:hover{background:#5c5cff;}
.btn-secondary{padding:8px 16px;border-radius:6px;border:1px solid #444;background:#222;color:#ccc;font-size:13px;cursor:pointer;}
.btn-secondary:hover{background:#333;}

/* ====== SCROLLBARS ====== */
::-webkit-scrollbar{width:6px;height:6px;}
::-webkit-scrollbar-track{background:#0f0f0f;}
::-webkit-scrollbar-thumb{background:#333;border-radius:3px;}
::-webkit-scrollbar-thumb:hover{background:#555;}

/* ====== SIDEBAR TOGGLE BUTTON ====== */
.sidebar-toggle{background:none;border:none;color:#666;cursor:pointer;padding:0 4px;font-size:16px;}
.sidebar-toggle:hover{color:#ccc;}
</style>
</head>
<body>

<!-- TOOLBAR -->
<header>
  <button class="sidebar-toggle" id="sidebar-toggle" title="Toggle sidebar">&#9776;</button>
  <h1>Gemini CLI as a Service</h1>
  <div class="toolbar-sep"></div>
  <span id="token-count"></span>
  <span id="health-status">Connecting...</span>
</header>

<!-- CONVERSATION BAR -->
<div class="conv-bar">
  <span>Conversation:</span>
  <select id="conv-select"><option value="">New conversation</option></select>
  <button id="new-conv">+ New</button>
  <div style="flex:1"></div>
</div>

<!-- MAIN 3-ZONE GRID -->
<div class="main">

  <!-- LEFT SIDEBAR -->
  <div class="sidebar" id="sidebar">
    <div class="sidebar-tabs">
      <button class="sidebar-tab active" data-pane="apps">Apps</button>
      <button class="sidebar-tab" data-pane="skills">Skills</button>
      <button class="sidebar-tab" data-pane="mcp">MCP</button>
      <button class="sidebar-tab" data-pane="cmds">Cmds</button>
    </div>

    <!-- Apps pane -->
    <div class="sidebar-pane active" id="pane-apps">
      <div class="app-filter-bar">
        <button class="app-filter-btn active" data-filter="all">All</button>
        <button class="app-filter-btn" data-filter="running">Running</button>
        <button class="app-filter-btn" data-filter="stopped">Stopped</button>
      </div>
      <div id="app-list" style="flex:1;overflow-y:auto;"></div>
    </div>

    <!-- Skills pane -->
    <div class="sidebar-pane" id="pane-skills">
      <div id="skills-list" style="flex:1;overflow-y:auto;"></div>
    </div>

    <!-- MCP pane -->
    <div class="sidebar-pane" id="pane-mcp">
      <div id="mcp-list" style="flex:1;overflow-y:auto;"></div>
      <button class="btn-add" id="add-mcp-btn">+ Add MCP Server</button>
    </div>

    <!-- Commands pane -->
    <div class="sidebar-pane" id="pane-cmds">
      <div id="cmds-list" style="flex:1;overflow-y:auto;"></div>
    </div>
  </div>

  <!-- CENTER CHAT -->
  <div class="chat-panel">
    <div id="messages"></div>
    <div id="input-area">
      <textarea id="msg-input" rows="1" placeholder="Send a message..." autofocus></textarea>
      <button id="send-btn">Send</button>
    </div>
  </div>

  <!-- CHAT/PANEL RESIZE HANDLE -->
  <div class="main-resize-handle" id="main-resize-handle"></div>

  <!-- RIGHT PANELS CONTAINER -->
  <div class="right-panels" id="right-panels"></div>
</div>

<!-- MCP MODAL -->
<div class="modal-backdrop hidden" id="mcp-modal">
  <div class="modal">
    <h2>Add MCP Server</h2>
    <label>Name</label>
    <input type="text" id="mcp-name" placeholder="my-server">
    <label>Command</label>
    <input type="text" id="mcp-cmd" placeholder="node server.js">
    <label>Args (comma-separated)</label>
    <input type="text" id="mcp-args" placeholder="--port,3200">
    <label>Env vars (KEY=value, one per line)</label>
    <textarea id="mcp-env" placeholder="API_KEY=abc123"></textarea>
    <div class="modal-actions">
      <button class="btn-secondary" id="mcp-cancel">Cancel</button>
      <button class="btn-primary" id="mcp-save">Add Server</button>
    </div>
  </div>
</div>

<!-- CONTEXT MENU (hidden by default) -->
<div class="context-menu" id="ctx-menu" style="display:none;"></div>

<script>
// ============================================================
// STATE
// ============================================================
var state = {
  conversationId: null,
  userId: 'web-user',
  apiKey: sessionStorage.getItem('apiKey') || '',
  sending: false,
  apps: [],
  appFilter: 'all',
  skills: [],
  mcpServers: [],
  commands: [],
  panels: [],         // [{id, name, url}]
  rightPanelWidth: 380,
  appGroups: JSON.parse(localStorage.getItem('appGroups') || '{}'),
  totalTokens: 0,
};

// ============================================================
// HELPERS
// ============================================================
function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function $(id) { return document.getElementById(id); }

function authFetch(url, opts) {
  opts = opts || {};
  if (!opts.headers) opts.headers = {};
  opts.headers['X-API-Key'] = state.apiKey;
  return fetch(url, opts);
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatTime(ms) {
  if (!ms) return '';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function saveLocalState() {
  try {
    var panels = state.panels.map(function(p) { return {id: p.id, name: p.name, url: p.url}; });
    localStorage.setItem('panels-' + (state.conversationId || 'default'), JSON.stringify(panels));
    localStorage.setItem('appGroups', JSON.stringify(state.appGroups));
  } catch(e) {}
}

function loadLocalState() {
  try {
    var key = 'panels-' + (state.conversationId || 'default');
    var raw = localStorage.getItem(key);
    if (raw) {
      var panels = JSON.parse(raw);
      panels.forEach(function(p) { openPanel(p.id, p.name, p.url); });
    }
  } catch(e) {}
}

// ============================================================
// AUTH
// ============================================================
function ensureAuth() {
  if (state.apiKey) return true;
  state.apiKey = prompt('Enter API key:');
  if (!state.apiKey) return false;
  sessionStorage.setItem('apiKey', state.apiKey);
  return true;
}

// ============================================================
// MARKED + HIGHLIGHT.JS SETUP
// ============================================================
function initMarked() {
  if (typeof marked === 'undefined') return;

  var renderer = new marked.Renderer();

  // Override code block renderer — detect :widget tags
  renderer.code = function(code, lang) {
    var actualCode = (typeof code === 'object' && code !== null) ? (code.text || '') : String(code || '');
    var actualLang = (typeof code === 'object' && code !== null) ? (code.lang || '') : String(lang || '');

    if (actualLang === 'html:widget' || actualLang === 'svg:widget') {
      var iframeId = 'widget-' + Math.random().toString(36).slice(2);
      var encoded = encodeURIComponent(actualCode);
      return '<iframe id="' + iframeId + '" class="widget-frame" sandbox="allow-scripts"' +
        ' srcdoc="' + escHtml(actualCode) + '" style="min-height:240px;"></iframe>';
    }

    var highlighted = actualCode;
    if (typeof hljs !== 'undefined' && actualLang) {
      try {
        var validLang = hljs.getLanguage(actualLang) ? actualLang : 'plaintext';
        highlighted = hljs.highlight(actualCode, {language: validLang}).value;
      } catch(e) {
        highlighted = escHtml(actualCode);
      }
    } else if (typeof hljs !== 'undefined') {
      try {
        highlighted = hljs.highlightAuto(actualCode).value;
      } catch(e) {
        highlighted = escHtml(actualCode);
      }
    } else {
      highlighted = escHtml(actualCode);
    }
    var langClass = actualLang ? ' class="hljs language-' + escHtml(actualLang) + '"' : ' class="hljs"';
    return '<pre><code' + langClass + '>' + highlighted + '</code></pre>';
  };

  marked.setOptions({
    renderer: renderer,
    breaks: true,
    gfm: true,
  });
}

function renderMarkdown(text) {
  if (typeof marked === 'undefined') return '<pre>' + escHtml(text) + '</pre>';
  try {
    return marked.parse(text || '');
  } catch(e) {
    return '<pre>' + escHtml(text) + '</pre>';
  }
}

// ============================================================
// HEALTH
// ============================================================
function checkHealth() {
  authFetch('/health').then(function(r) {
    return r.json();
  }).then(function(d) {
    var el = $('health-status');
    el.textContent = 'v' + (d.cliVersion || '?') + ' | up ' + Math.round(d.uptime || 0) + 's';
    el.className = '';
  }).catch(function() {
    var el = $('health-status');
    el.textContent = 'Disconnected';
    el.className = 'off';
  });
}

// ============================================================
// CONVERSATIONS
// ============================================================
async function loadConversations() {
  try {
    var r = await authFetch('/conversations/list?user_id=' + state.userId);
    var d = await r.json();
    var sel = $('conv-select');
    sel.innerHTML = '<option value="">New conversation</option>';
    (d.conversations || []).forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c.conversationId;
      opt.textContent = (c.firstMessage || c.name || c.conversationId.slice(0, 8)) + ' (' + (c.turnCount || 0) + ' turns)';
      if (c.conversationId === state.conversationId) opt.selected = true;
      sel.appendChild(opt);
    });
  } catch(e) {}
}

$('conv-select').addEventListener('change', function() {
  var id = this.value;
  if (id) {
    state.conversationId = id;
    $('messages').innerHTML = '';
    addSystemMsg('Switched to conversation ' + id.slice(0, 8) + '...');
    loadLocalState();
  }
});

$('new-conv').addEventListener('click', function() {
  state.conversationId = null;
  state.totalTokens = 0;
  $('messages').innerHTML = '';
  updateTokens();
  addSystemMsg('New conversation started.');
  loadConversations();
});

// ============================================================
// MESSAGE DISPLAY
// ============================================================
function addSystemMsg(text) {
  var wrap = document.createElement('div');
  wrap.className = 'msg-wrap system-msg';
  var inner = document.createElement('div');
  inner.className = 'msg system-text';
  inner.textContent = text;
  wrap.appendChild(inner);
  $('messages').appendChild(wrap);
  scrollBottom();
  return wrap;
}

function addUserMsg(text) {
  var wrap = document.createElement('div');
  wrap.className = 'msg-wrap user';
  var inner = document.createElement('div');
  inner.className = 'msg user-msg';
  inner.textContent = text;
  wrap.appendChild(inner);
  $('messages').appendChild(wrap);
  scrollBottom();
  return wrap;
}

function addAssistantMsg() {
  var wrap = document.createElement('div');
  wrap.className = 'msg-wrap assistant';
  var inner = document.createElement('div');
  inner.className = 'msg assistant-msg';
  var meta = document.createElement('div');
  meta.className = 'msg-meta';
  wrap.appendChild(inner);
  wrap.appendChild(meta);
  $('messages').appendChild(wrap);
  scrollBottom();
  return {wrap: wrap, content: inner, meta: meta};
}

function createToolCard(type, title, body) {
  // type: 'use' or 'result'
  var wrap = document.createElement('div');
  wrap.className = 'msg-wrap ' + (type === 'use' ? 'tool-use-wrap' : 'tool-result-wrap');

  var card = document.createElement('div');
  card.className = 'tool-card' + (type === 'result' ? ' result' : '');

  var header = document.createElement('div');
  header.className = 'tool-card-header';

  var icon = document.createElement('span');
  icon.className = 'tool-card-icon';
  icon.textContent = type === 'use' ? '\u2699\uFE0F' : '\u2713';

  var nameEl = document.createElement('span');
  nameEl.className = 'tool-card-name';
  nameEl.textContent = escHtml(title);

  var chevron = document.createElement('span');
  chevron.className = 'tool-card-chevron';
  chevron.textContent = '>';

  header.appendChild(icon);
  header.appendChild(nameEl);
  header.appendChild(chevron);

  var bodyEl = document.createElement('div');
  bodyEl.className = 'tool-card-body';
  bodyEl.textContent = body;

  header.addEventListener('click', function() {
    card.classList.toggle('expanded');
  });

  card.appendChild(header);
  card.appendChild(bodyEl);
  wrap.appendChild(card);
  $('messages').appendChild(wrap);
  scrollBottom();
  return card;
}

function scrollBottom() {
  var m = $('messages');
  m.scrollTop = m.scrollHeight;
}

function updateTokens() {
  $('token-count').textContent = state.totalTokens ? state.totalTokens.toLocaleString() + ' tokens' : '';
}

// ============================================================
// APPROVAL GATE
// ============================================================
function subscribeApprovals() {
  if (!state.apiKey) return;
  var es = new EventSource('/approvals/subscribe?api_key=' + encodeURIComponent(state.apiKey));
  es.addEventListener('approval_request', function(e) {
    try { showApprovalRequest(JSON.parse(e.data)); } catch(err) {}
  });
  es.addEventListener('approved', function(e) {
    try { resolveApproval(JSON.parse(e.data).requestId, 'Approved'); } catch(err) {}
  });
  es.addEventListener('rejected', function(e) {
    try { resolveApproval(JSON.parse(e.data).requestId, 'Rejected'); } catch(err) {}
  });
  es.addEventListener('timeout', function(e) {
    try { resolveApproval(JSON.parse(e.data).requestId, 'Timed out'); } catch(err) {}
  });
  es.onerror = function() { setTimeout(subscribeApprovals, 5000); };
}

function showApprovalRequest(req) {
  var wrap = document.createElement('div');
  wrap.className = 'msg-wrap assistant';
  wrap.id = 'approval-' + escHtml(req.requestId);

  var inner = document.createElement('div');
  inner.className = 'msg approval';

  var title = document.createElement('div');
  title.innerHTML = '<strong>Approval Required:</strong> ' + escHtml(req.action);

  var desc = document.createElement('div');
  desc.style.cssText = 'font-size:12px;color:#aaa;margin-top:4px;font-family:monospace;';
  desc.textContent = String(req.description || '').slice(0, 300);

  var actions = document.createElement('div');
  actions.className = 'approval-actions';

  var approveBtn = document.createElement('button');
  approveBtn.className = 'btn-approve';
  approveBtn.textContent = 'Approve';
  approveBtn.addEventListener('click', function() { handleApproval(req.requestId, true); });

  var rejectBtn = document.createElement('button');
  rejectBtn.className = 'btn-reject';
  rejectBtn.textContent = 'Reject';
  rejectBtn.addEventListener('click', function() { handleApproval(req.requestId, false); });

  actions.appendChild(approveBtn);
  actions.appendChild(rejectBtn);

  inner.appendChild(title);
  inner.appendChild(desc);
  inner.appendChild(actions);
  wrap.appendChild(inner);
  $('messages').appendChild(wrap);
  scrollBottom();
}

function resolveApproval(requestId, status) {
  var wrap = document.getElementById('approval-' + requestId);
  if (!wrap) return;
  var actions = wrap.querySelector('.approval-actions');
  if (actions) {
    actions.innerHTML = '';
    var span = document.createElement('span');
    span.className = 'approval-resolved';
    span.textContent = status;
    actions.appendChild(span);
  }
}

async function handleApproval(requestId, approve) {
  var endpoint = approve
    ? '/approvals/' + encodeURIComponent(requestId) + '/approve'
    : '/approvals/' + encodeURIComponent(requestId) + '/reject';
  try {
    await authFetch(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
  } catch(e) {}
}

// ============================================================
// A2UI STRUCTURED PANEL RENDERERS
// ============================================================
function detectTestPattern(text) {
  return /\\d+\\s+passing|\\d+\\s+failing|PASS|FAIL/.test(text || '');
}

function renderA2uiPanel(template, data, label) {
  var wrap = document.createElement('div');
  wrap.className = 'msg-wrap assistant';

  var panel = document.createElement('div');
  panel.className = 'a2ui-panel';

  var header = document.createElement('div');
  header.className = 'a2ui-header';

  var body = document.createElement('div');
  body.className = 'a2ui-body';

  switch (template) {
    case 'test_results':
      renderTestResults(header, body, data, label);
      break;
    case 'app_inventory':
      renderAppInventory(header, body, data, label);
      break;
    case 'selection_list':
      renderSelectionList(header, body, data, label);
      break;
    case 'token_usage':
      renderTokenUsage(header, body, data, label);
      break;
    case 'file_changes':
      renderFileChanges(header, body, data, label);
      break;
    case 'table':
      renderGenericTable(header, body, data, label);
      break;
    default:
      header.textContent = label || template;
      var pre = document.createElement('pre');
      pre.style.cssText = 'font-size:11px;color:#888;white-space:pre-wrap;word-wrap:break-word;';
      pre.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      body.appendChild(pre);
  }

  panel.appendChild(header);
  panel.appendChild(body);
  wrap.appendChild(panel);
  $('messages').appendChild(wrap);
  scrollBottom();
}

function renderTestResults(header, body, data, label) {
  var results = Array.isArray(data) ? data : (data.results || []);
  var passing = results.filter(function(r) { return r.status === 'pass' || r.pass === true; }).length;
  var failing = results.length - passing;

  header.className = 'a2ui-header ' + (failing > 0 ? 'fail' : 'pass');
  header.textContent = (label || 'Test Results') + ' — ' + passing + ' passing, ' + failing + ' failing';

  var tbl = document.createElement('table');
  tbl.className = 'test-table';
  tbl.innerHTML = '<thead><tr><th></th><th>Test</th><th>Duration</th><th>Error</th></tr></thead>';
  var tbody = document.createElement('tbody');

  results.forEach(function(r) {
    var pass = r.status === 'pass' || r.pass === true;
    var tr = document.createElement('tr');
    var icon = document.createElement('td');
    icon.className = pass ? 'pass-icon' : 'fail-icon';
    icon.textContent = pass ? '✓' : '✗';
    var name = document.createElement('td');
    name.textContent = r.name || r.test || '';
    var dur = document.createElement('td');
    dur.textContent = r.duration ? formatTime(r.duration) : '';
    var err = document.createElement('td');
    err.style.cssText = 'color:#a66;font-size:11px;font-family:monospace;';
    err.textContent = r.error || '';
    tr.appendChild(icon); tr.appendChild(name); tr.appendChild(dur); tr.appendChild(err);
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  body.appendChild(tbl);
}

function renderAppInventory(header, body, data, label) {
  header.textContent = label || 'App Inventory';
  var apps = Array.isArray(data) ? data : (data.apps || []);
  var grid = document.createElement('div');
  grid.className = 'app-inv-grid';

  apps.forEach(function(app) {
    var card = document.createElement('div');
    card.className = 'app-inv-card';

    var nameEl = document.createElement('div');
    nameEl.className = 'inv-name';
    var dot = document.createElement('span');
    dot.className = 'status-dot ' + (app.status || 'stopped');
    nameEl.appendChild(dot);
    var nameText = document.createTextNode(app.name || '');
    nameEl.appendChild(nameText);

    var urlEl = document.createElement('div');
    urlEl.className = 'inv-url';
    if (app.url) {
      var link = document.createElement('a');
      link.href = app.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = app.url;
      urlEl.appendChild(link);
    }

    var portEl = document.createElement('div');
    portEl.className = 'inv-port';
    if (app.port) portEl.textContent = 'Port: ' + app.port;

    card.appendChild(nameEl);
    card.appendChild(urlEl);
    card.appendChild(portEl);
    grid.appendChild(card);
  });
  body.appendChild(grid);
}

function renderSelectionList(header, body, data, label) {
  header.textContent = label || 'Select an option';
  var items = Array.isArray(data) ? data : (data.items || []);
  var ul = document.createElement('ul');
  ul.className = 'sel-list';

  items.forEach(function(item) {
    var li = document.createElement('li');
    li.textContent = typeof item === 'string' ? item : (item.label || item.name || JSON.stringify(item));
    li.addEventListener('click', function() {
      var val = typeof item === 'string' ? item : (item.value || item.name || item.label);
      sendText(String(val));
    });
    ul.appendChild(li);
  });
  body.appendChild(ul);
}

function renderTokenUsage(header, body, data, label) {
  header.textContent = label || 'Token Usage';
  var grid = document.createElement('div');
  grid.className = 'token-grid';

  var fields = [
    {key: 'input_tokens', label: 'Input'},
    {key: 'output_tokens', label: 'Output'},
    {key: 'cache_read_tokens', label: 'Cached'},
    {key: 'total_tokens', label: 'Total'},
    {key: 'cost_usd', label: 'Cost (USD)', fmt: function(v) { return '$' + Number(v).toFixed(4); }},
  ];

  fields.forEach(function(f) {
    if (data[f.key] == null) return;
    var card = document.createElement('div');
    card.className = 'token-card';
    var val = document.createElement('div');
    val.className = 'token-val';
    val.textContent = f.fmt ? f.fmt(data[f.key]) : Number(data[f.key]).toLocaleString();
    var lbl = document.createElement('div');
    lbl.className = 'token-label';
    lbl.textContent = f.label;
    card.appendChild(val); card.appendChild(lbl);
    grid.appendChild(card);
  });
  body.appendChild(grid);
}

function renderFileChanges(header, body, data, label) {
  header.textContent = label || 'File Changes';
  var lines = Array.isArray(data) ? data : (data.lines || String(data).split('\\n'));
  var container = document.createElement('div');
  container.style.cssText = 'max-height:400px;overflow-y:auto;border-radius:4px;background:#0f0f0f;padding:4px 0;';

  lines.forEach(function(line) {
    var el = document.createElement('div');
    el.className = 'diff-line';
    var s = typeof line === 'string' ? line : (line.text || String(line));
    if (s.startsWith('+') && !s.startsWith('+++')) {
      el.classList.add('add');
    } else if (s.startsWith('-') && !s.startsWith('---')) {
      el.classList.add('del');
    } else {
      el.classList.add('ctx');
    }
    el.textContent = s;
    container.appendChild(el);
  });
  body.appendChild(container);
}

function renderGenericTable(header, body, data, label) {
  header.textContent = label || 'Table';
  var rows = Array.isArray(data) ? data : (data.rows || []);
  if (!rows.length) { body.textContent = 'No data.'; return; }

  var cols = data.columns || Object.keys(rows[0]);
  var sortCol = null;
  var sortDir = 1;

  var tbl = document.createElement('table');
  tbl.className = 'generic-table';
  var thead = document.createElement('thead');
  var htr = document.createElement('tr');

  cols.forEach(function(col) {
    var th = document.createElement('th');
    th.textContent = col;
    th.addEventListener('click', function() {
      if (sortCol === col) sortDir *= -1;
      else { sortCol = col; sortDir = 1; }
      renderRows();
    });
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  tbl.appendChild(thead);

  var tbody = document.createElement('tbody');
  tbl.appendChild(tbody);

  function renderRows() {
    tbody.innerHTML = '';
    var sorted = rows.slice();
    if (sortCol) {
      sorted.sort(function(a, b) {
        var av = a[sortCol]; var bv = b[sortCol];
        if (av < bv) return -sortDir;
        if (av > bv) return sortDir;
        return 0;
      });
    }
    sorted.forEach(function(row) {
      var tr = document.createElement('tr');
      cols.forEach(function(col) {
        var td = document.createElement('td');
        td.textContent = row[col] != null ? row[col] : '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  renderRows();
  body.appendChild(tbl);
}

// ============================================================
// SSE / SEND
// ============================================================
async function sendText(text) {
  if (!text || state.sending) return;

  if (!state.conversationId) {
    try {
      var r = await authFetch('/conversations/new', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({user_id: state.userId, name: text.slice(0, 50)}),
      });
      var d = await r.json();
      state.conversationId = d.conversationId;
      loadConversations();
      saveLocalState();
    } catch(e) { addSystemMsg('Error creating conversation: ' + e.message); return; }
  }

  addUserMsg(text);
  state.sending = true;
  $('send-btn').disabled = true;

  var asst = addAssistantMsg();
  var fullContent = '';

  try {
    var resp = await authFetch('/send', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({user_id: state.userId, conversation_id: state.conversationId, text: text}),
    });

    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, {stream: true});

      var lines = buffer.split('\\n');
      buffer = lines.pop();

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line.startsWith('data:')) continue;
        try {
          var ev = JSON.parse(line.slice(5).trim());
          handleSSEEvent(ev, asst, function(c) { fullContent = c; });
        } catch(e) {}
      }
    }

    if (!fullContent) {
      asst.content.innerHTML = '<span style="color:#666;font-style:italic;">(no text response)</span>';
    }
  } catch(err) {
    asst.content.innerHTML = '<span style="color:#a44;">Error: ' + escHtml(err.message) + '</span>';
  }

  state.sending = false;
  $('send-btn').disabled = false;
  $('msg-input').focus();
}

function handleSSEEvent(ev, asst, setContent) {
  if (ev.type === 'message' && ev.role === 'assistant') {
    var content = asst.content._rawContent || '';
    content += (ev.content || '');
    asst.content._rawContent = content;
    asst.content.innerHTML = renderMarkdown(content);
    setContent(content);
    scrollBottom();

  } else if (ev.type === 'tool_use') {
    var params = '';
    try { params = JSON.stringify(ev.parameters || {}, null, 2); } catch(e) { params = '{}'; }
    createToolCard('use', ev.tool_name || 'tool', params);
    checkForAppCreation(ev);

  } else if (ev.type === 'tool_result') {
    var output = String(ev.output || ev.status || '');
    createToolCard('result', (ev.tool_name || 'result') + ' result', output.slice(0, 2000));
    checkTestPatternInResult(output);
    checkForAppCreation(ev);

  } else if (ev.type === 'result' && ev.stats) {
    state.totalTokens += (ev.stats.total_tokens || 0);
    updateTokens();
    asst.meta.textContent = formatTime(ev.stats.duration_ms);
    if (ev.stats.usage) renderA2uiPanel('token_usage', ev.stats.usage, 'Token Usage');

  } else if (ev.type === 'system_warning') {
    addSystemMsg(ev.message || 'System warning');

  } else if (ev.type === 'a2ui') {
    // Backend sends a2ui events directly (not nested under ev.data)
    if (ev.component === 'table' || ev.template === 'table') {
      renderA2uiPanel('table', ev, ev.title || 'Table');
    } else if (ev.component === 'app_inventory') {
      renderA2uiPanel('app_inventory', ev, ev.title || 'Running Applications');
    } else if (ev.component === 'app_created') {
      renderA2uiPanel('app_created', ev, ev.title || 'App Created');
    } else {
      var tmpl = ev.component || ev.template || 'table';
      renderA2uiPanel(tmpl, ev, ev.title || ev.label || tmpl);
    }

  } else if (ev.type === 'event') {
    // A2UI structured panels
    var inner = ev.data || {};
    if (inner.type === 'a2ui' && inner.template) {
      renderA2uiPanel(inner.template, inner.data || {}, inner.label);
    } else if (inner.template && inner.data) {
      renderA2uiPanel(inner.template, inner.data, inner.label);
    }
  }
}

function checkTestPatternInResult(output) {
  if (!detectTestPattern(output)) return;
  // Parse simple mocha/jest-like output into test_results
  var passing = [];
  var failing = [];

  var passMatch = output.match(/(\\d+)\\s+passing/);
  var failMatch = output.match(/(\\d+)\\s+failing/);

  var lines = output.split('\\n');
  lines.forEach(function(line) {
    var passLine = line.match(/^\\s+\\d+\\)\\s+(.+)$/) || line.match(/^\\s+✓\\s+(.+)/);
    var failLine = line.match(/^\\s+\\d+\\)\\s+(.+)\\s+\\(failed\\)/) || line.match(/^\\s+✗\\s+(.+)/);

    if (passLine) passing.push({name: passLine[1], status: 'pass'});
    if (failLine) failing.push({name: failLine[1], status: 'fail'});
  });

  if (passing.length === 0 && failing.length === 0) {
    // Fallback: create summary rows
    if (passMatch) {
      for (var i = 0; i < Math.min(parseInt(passMatch[1], 10), 20); i++) {
        passing.push({name: 'Test ' + (i + 1), status: 'pass'});
      }
    }
    if (failMatch) {
      for (var j = 0; j < Math.min(parseInt(failMatch[1], 10), 20); j++) {
        failing.push({name: 'Test ' + (j + 1), status: 'fail'});
      }
    }
  }

  if (passing.length || failing.length) {
    renderA2uiPanel('test_results', {results: passing.concat(failing)}, 'Test Results');
  }
}

function checkForAppCreation(ev) {
  // Detect app creation from tool results or tool_use parameters
  var toolName = ev.tool_name || '';

  if (toolName.includes('app') || toolName.includes('create')) {
    var url = null;
    var name = null;

    // Check parameters (tool_use events) for app name
    if (ev.parameters && typeof ev.parameters === 'object') {
      name = ev.parameters.name || ev.parameters.app_name || null;
    }

    // Handle ev.output being an object (parsed JSON) or a string
    if (ev.output && typeof ev.output === 'object') {
      url = ev.output.url || null;
      name = name || ev.output.name || ev.output.app_name || null;
    } else if (ev.output) {
      // Try to parse as JSON first
      var parsed = null;
      try { parsed = JSON.parse(ev.output); } catch(e) {}
      if (parsed && typeof parsed === 'object') {
        url = parsed.url || null;
        name = name || parsed.name || parsed.app_name || null;
      } else {
        // Fall back to regex on string
        var outputStr = String(ev.output);
        var urlMatch = outputStr.match(/https?:\\/\\/[\\w.:\\-/]+/);
        if (urlMatch) {
          url = urlMatch[0];
          var nameMatch = outputStr.match(/name['":\\s]+([\\w-]+)/i);
          name = name || (nameMatch ? nameMatch[1] : null);
        }
      }
    }

    if (url) {
      openPanel(url, name || url, url);
    }
  }

  // Also refresh app drawer
  setTimeout(loadApps, 1000);
}

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
    var text = this.value.trim();
    if (text) {
      this.value = '';
      this.style.height = 'auto';
      sendText(text);
    }
  }
});

$('send-btn').addEventListener('click', function() {
  var text = $('msg-input').value.trim();
  if (text) {
    $('msg-input').value = '';
    $('msg-input').style.height = 'auto';
    sendText(text);
  }
});

// ============================================================
// RIGHT PANELS (Embedded App Iframes)
// ============================================================
function renderPanels() {
  var container = $('right-panels');
  container.innerHTML = '';

  var mainHandle = $('main-resize-handle');
  if (!state.panels.length) {
    if (mainHandle) mainHandle.classList.remove('visible');
    return;
  }
  if (mainHandle) mainHandle.classList.add('visible');

  var totalWidth = Math.min(state.rightPanelWidth, Math.floor(window.innerWidth * 0.3));
  container.style.width = (totalWidth * state.panels.length) + 'px';

  state.panels.forEach(function(p, idx) {
    if (idx > 0) {
      var handle = document.createElement('div');
      handle.className = 'resize-handle';
      setupResizeHandle(handle, container, idx);
      container.appendChild(handle);
    }

    var panel = document.createElement('div');
    panel.className = 'right-panel';
    panel.style.width = totalWidth + 'px';
    panel.id = 'panel-' + p.id;

    var hdr = document.createElement('div');
    hdr.className = 'panel-header';

    var title = document.createElement('span');
    title.className = 'panel-title';
    title.title = p.url;
    title.textContent = p.name;

    var expandBtn = document.createElement('button');
    expandBtn.className = 'panel-btn';
    expandBtn.title = 'Open in tab';
    expandBtn.textContent = '↗';
    (function(url) {
      expandBtn.addEventListener('click', function() { window.open(url, '_blank', 'noopener,noreferrer'); });
    })(p.url);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'panel-btn';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    (function(pid) {
      closeBtn.addEventListener('click', function() { closePanel(pid); });
    })(p.id);

    hdr.appendChild(title);
    hdr.appendChild(expandBtn);
    hdr.appendChild(closeBtn);

    var iframe = document.createElement('iframe');
    iframe.className = 'panel-iframe';
    iframe.src = p.url;
    iframe.title = p.name;
    // Allow basic features but keep restricted
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');

    panel.appendChild(hdr);
    panel.appendChild(iframe);
    container.appendChild(panel);
  });

  saveLocalState();
}

function openPanel(id, name, url) {
  if (state.panels.length >= 2) return; // max 2 panels
  if (state.panels.find(function(p) { return p.id === id; })) return;
  state.panels.push({id: id, name: name, url: url});
  renderPanels();
}

function closePanel(id) {
  state.panels = state.panels.filter(function(p) { return p.id !== id; });
  renderPanels();
  if (!state.panels.length) {
    $('right-panels').style.width = '';
    var mainHandle = $('main-resize-handle');
    if (mainHandle) mainHandle.classList.remove('visible');
  }
  saveLocalState();
}

function setupResizeHandle(handle, container, idx) {
  var startX, startW;
  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    startX = e.clientX;
    startW = state.rightPanelWidth;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  function onMove(e) {
    var dx = startX - e.clientX; // dragging left increases panel width
    state.rightPanelWidth = Math.max(240, Math.min(800, startW + dx));
    // Update widths directly without full DOM rebuild
    var panels = container.querySelectorAll('.right-panel');
    panels.forEach(function(p) { p.style.width = state.rightPanelWidth + 'px'; });
    container.style.width = (state.rightPanelWidth * state.panels.length + (state.panels.length - 1) * 5) + 'px';
  }
  function onUp() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
}

function setupMainResizeHandle() {
  var handle = $('main-resize-handle');
  if (!handle) return;
  var startX, startW;
  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    startX = e.clientX;
    startW = state.rightPanelWidth;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onMainMove);
    document.addEventListener('mouseup', onMainUp);
  });
  function onMainMove(e) {
    var dx = startX - e.clientX; // dragging left expands right panels
    var maxW = Math.floor(window.innerWidth * 0.6);
    state.rightPanelWidth = Math.max(240, Math.min(maxW, startW + dx));
    var container = $('right-panels');
    var panels = container.querySelectorAll('.right-panel');
    panels.forEach(function(p) { p.style.width = state.rightPanelWidth + 'px'; });
    container.style.width = (state.rightPanelWidth * state.panels.length + (state.panels.length - 1) * 5) + 'px';
  }
  function onMainUp() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMainMove);
    document.removeEventListener('mouseup', onMainUp);
  }
}

// ============================================================
// APP DRAWER
// ============================================================
async function loadApps() {
  try {
    var r = await authFetch('/apps?user_id=' + state.userId);
    var d = await r.json();
    state.apps = d.apps || d || [];
    renderAppList();
  } catch(e) {}
}

function renderAppList() {
  var container = $('app-list');
  container.innerHTML = '';

  var filtered = state.apps.filter(function(app) {
    if (state.appFilter === 'all') return true;
    if (state.appFilter === 'running') return app.status === 'running';
    if (state.appFilter === 'stopped') return app.status !== 'running';
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state">No apps found.</div>';
    return;
  }

  // Group by state.appGroups
  var groups = {};
  var ungrouped = [];

  filtered.forEach(function(app) {
    var groupName = state.appGroups[app.name];
    if (groupName) {
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(app);
    } else {
      ungrouped.push(app);
    }
  });

  // Render groups
  Object.keys(groups).forEach(function(groupName) {
    var ghdr = document.createElement('div');
    ghdr.className = 'app-group-header';
    ghdr.innerHTML = '&#9654; ' + escHtml(groupName);
    var groupContainer = document.createElement('div');

    ghdr.addEventListener('click', function() {
      var expanded = groupContainer.style.display !== 'none';
      groupContainer.style.display = expanded ? 'none' : '';
      ghdr.innerHTML = (expanded ? '&#9654; ' : '&#9660; ') + escHtml(groupName);
    });

    container.appendChild(ghdr);
    groups[groupName].forEach(function(app) {
      groupContainer.appendChild(createAppCard(app));
    });
    container.appendChild(groupContainer);
  });

  // Render ungrouped
  ungrouped.forEach(function(app) {
    container.appendChild(createAppCard(app));
  });
}

function createAppCard(app) {
  var card = document.createElement('div');
  card.className = 'app-card';
  card.draggable = true;
  card.dataset.appName = app.name;

  var nameEl = document.createElement('div');
  nameEl.className = 'app-name';
  var dot = document.createElement('span');
  dot.className = 'status-dot ' + (app.status || 'stopped');
  nameEl.appendChild(dot);
  nameEl.appendChild(document.createTextNode(app.name));

  var urlEl = document.createElement('div');
  urlEl.className = 'app-url';
  if (app.url) {
    var link = document.createElement('a');
    link.href = app.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = app.url;
    link.addEventListener('click', function(e) { e.stopPropagation(); });
    urlEl.appendChild(link);
  }

  var metaEl = document.createElement('div');
  metaEl.className = 'app-meta';
  if (app.lastModified) metaEl.textContent = 'Updated: ' + new Date(app.lastModified).toLocaleString();

  card.appendChild(nameEl);
  card.appendChild(urlEl);
  card.appendChild(metaEl);

  // Left-click to open in panel
  card.addEventListener('click', function() {
    if (app.url) openPanel(app.name, app.name, app.url);
  });

  // Right-click context menu
  card.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, app);
  });

  // Drag for grouping
  card.addEventListener('dragstart', function(e) {
    e.dataTransfer.setData('text/plain', app.name);
  });
  card.addEventListener('dragover', function(e) { e.preventDefault(); });
  card.addEventListener('drop', function(e) {
    e.preventDefault();
    var dragged = e.dataTransfer.getData('text/plain');
    if (dragged && dragged !== app.name) {
      var group = state.appGroups[app.name] || app.name + '-group';
      state.appGroups[dragged] = group;
      state.appGroups[app.name] = group;
      saveLocalState();
      renderAppList();
    }
  });

  return card;
}

function showContextMenu(x, y, app) {
  hideContextMenu();
  var menu = $('ctx-menu');
  menu.innerHTML = '';

  var items = [
    {label: 'Open in Panel', action: function() { if (app.url) openPanel(app.name, app.name, app.url); }},
    {label: 'Open in Tab', action: function() { if (app.url) window.open(app.url, '_blank', 'noopener,noreferrer'); }},
    {label: 'Go to Conversation', action: function() {
      // Scroll messages to find a reference to this app or open new conv context
      addSystemMsg('App: ' + app.name + (app.url ? ' (' + app.url + ')' : ''));
    }},
    {sep: true},
    {label: 'Stop', action: function() { appAction(app.name, 'stop'); }},
    {label: 'Restart', action: function() { appAction(app.name, 'restart'); }},
    {label: 'Delete', action: function() {
      if (confirm('Delete app "' + app.name + '"?')) {
        appAction(app.name, 'delete');
      }
    }},
    {sep: true},
    {label: 'Remove Group', action: function() {
      delete state.appGroups[app.name];
      saveLocalState();
      renderAppList();
    }},
  ];

  items.forEach(function(item) {
    if (item.sep) {
      var sep = document.createElement('div');
      sep.className = 'context-menu-sep';
      menu.appendChild(sep);
      return;
    }
    var el = document.createElement('div');
    el.className = 'context-menu-item';
    el.textContent = item.label;
    (function(action) {
      el.addEventListener('click', function() { hideContextMenu(); action(); });
    })(item.action);
    menu.appendChild(el);
  });

  menu.style.display = 'block';
  menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 10) + 'px';
}

function hideContextMenu() {
  var menu = $('ctx-menu');
  menu.style.display = 'none';
  menu.innerHTML = '';
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') hideContextMenu(); });

async function appAction(name, action) {
  try {
    await authFetch('/apps/' + encodeURIComponent(name) + '/' + action, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({user_id: state.userId}),
    });
    setTimeout(loadApps, 1000);
  } catch(e) { addSystemMsg('Error: ' + e.message); }
}

// Filter buttons
document.querySelectorAll('.app-filter-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    state.appFilter = this.dataset.filter;
    document.querySelectorAll('.app-filter-btn').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    renderAppList();
  });
});

// ============================================================
// SKILLS
// ============================================================
async function loadSkills() {
  try {
    var r = await authFetch('/skills');
    var d = await r.json();
    state.skills = d.skills || d || [];
    renderSkills();
  } catch(e) {}
}

function renderSkills() {
  var container = $('skills-list');
  container.innerHTML = '';

  if (!state.skills.length) {
    container.innerHTML = '<div class="empty-state">No skills found.</div>';
    return;
  }

  state.skills.forEach(function(skill) {
    var item = document.createElement('div');
    item.className = 'skill-item';

    var info = document.createElement('div');
    info.style.flex = '1';
    var nameEl = document.createElement('div');
    nameEl.className = 'skill-name';
    nameEl.textContent = skill.name;
    var descEl = document.createElement('div');
    descEl.className = 'skill-desc';
    descEl.textContent = skill.description || '';
    info.appendChild(nameEl);
    info.appendChild(descEl);

    var label = document.createElement('label');
    label.className = 'toggle-switch';

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = skill.enabled !== false;

    var track = document.createElement('span');
    track.className = 'toggle-track';

    var thumb = document.createElement('span');
    thumb.className = 'toggle-thumb';

    label.appendChild(input);
    label.appendChild(track);
    label.appendChild(thumb);

    (function(skillName) {
      input.addEventListener('change', function() {
        toggleSkill(skillName);
      });
    })(skill.name);

    item.appendChild(info);
    item.appendChild(label);
    container.appendChild(item);
  });
}

async function toggleSkill(name) {
  try {
    await authFetch('/skills/' + encodeURIComponent(name) + '/toggle', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{}',
    });
    loadSkills();
  } catch(e) {}
}

// ============================================================
// MCP SERVERS
// ============================================================
async function loadMcpServers() {
  try {
    var r = await authFetch('/mcp-servers');
    var d = await r.json();
    state.mcpServers = d.servers || d || [];
    renderMcpServers();
  } catch(e) {}
}

function renderMcpServers() {
  var container = $('mcp-list');
  container.innerHTML = '';

  if (!state.mcpServers.length) {
    container.innerHTML = '<div class="empty-state">No MCP servers configured.</div>';
    return;
  }

  state.mcpServers.forEach(function(srv) {
    var item = document.createElement('div');
    item.className = 'mcp-item';

    var nameEl = document.createElement('div');
    nameEl.className = 'mcp-name';
    var dot = document.createElement('span');
    dot.className = 'status-dot ' + (srv.status === 'connected' ? 'running' : (srv.status === 'error' ? 'error' : 'stopped'));
    nameEl.appendChild(dot);
    nameEl.appendChild(document.createTextNode(srv.name));

    var toolsEl = document.createElement('div');
    toolsEl.className = 'mcp-tools';
    toolsEl.textContent = (srv.toolCount || 0) + ' tools | ' + (srv.status || 'unknown');

    var actions = document.createElement('div');
    actions.className = 'mcp-actions';

    var testBtn = document.createElement('button');
    testBtn.className = 'btn-sm';
    testBtn.textContent = 'Test';
    (function(name) {
      testBtn.addEventListener('click', function() { testMcpServer(name); });
    })(srv.name);

    var delBtn = document.createElement('button');
    delBtn.className = 'btn-sm danger';
    delBtn.textContent = 'Delete';
    (function(name) {
      delBtn.addEventListener('click', function() { deleteMcpServer(name); });
    })(srv.name);

    actions.appendChild(testBtn);
    actions.appendChild(delBtn);

    item.appendChild(nameEl);
    item.appendChild(toolsEl);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

async function testMcpServer(name) {
  try {
    var r = await authFetch('/mcp-servers/' + encodeURIComponent(name) + '/test', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
    var d = await r.json();
    addSystemMsg('MCP ' + name + ': ' + (d.message || d.status || JSON.stringify(d)));
  } catch(e) { addSystemMsg('MCP test error: ' + e.message); }
}

async function deleteMcpServer(name) {
  if (!confirm('Delete MCP server "' + name + '"?')) return;
  try {
    await authFetch('/mcp-servers/' + encodeURIComponent(name), {method: 'DELETE'});
    loadMcpServers();
  } catch(e) { addSystemMsg('Error deleting MCP server: ' + e.message); }
}

// Add MCP modal
$('add-mcp-btn').addEventListener('click', function() {
  $('mcp-modal').classList.remove('hidden');
  $('mcp-name').focus();
});

$('mcp-cancel').addEventListener('click', function() {
  $('mcp-modal').classList.add('hidden');
});

$('mcp-save').addEventListener('click', async function() {
  var name = $('mcp-name').value.trim();
  var cmd = $('mcp-cmd').value.trim();
  var argsRaw = $('mcp-args').value.trim();
  var envRaw = $('mcp-env').value.trim();

  if (!name || !cmd) { alert('Name and command are required.'); return; }

  var args = argsRaw ? argsRaw.split(',').map(function(s) { return s.trim(); }) : [];
  var env = {};
  envRaw.split('\\n').forEach(function(line) {
    var eq = line.indexOf('=');
    if (eq > 0) {
      env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  });

  try {
    await authFetch('/mcp-servers', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: name, command: cmd, args: args, env: env}),
    });
    $('mcp-modal').classList.add('hidden');
    $('mcp-name').value = '';
    $('mcp-cmd').value = '';
    $('mcp-args').value = '';
    $('mcp-env').value = '';
    loadMcpServers();
  } catch(e) { addSystemMsg('Error adding MCP server: ' + e.message); }
});

// Close modal on backdrop click
$('mcp-modal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.add('hidden');
});

// ============================================================
// COMMANDS
// ============================================================
async function loadCommands() {
  try {
    var r = await authFetch('/commands');
    var d = await r.json();
    state.commands = d.commands || d || [];
    renderCommands();
  } catch(e) {}
}

function renderCommands() {
  var container = $('cmds-list');
  container.innerHTML = '';

  if (!state.commands.length) {
    container.innerHTML = '<div class="empty-state">No commands found.</div>';
    return;
  }

  state.commands.forEach(function(cmd) {
    var item = document.createElement('div');
    item.className = 'cmd-item';

    var nameEl = document.createElement('div');
    nameEl.className = 'cmd-name';
    nameEl.textContent = '/' + (cmd.name || cmd);

    var descEl = document.createElement('div');
    descEl.style.cssText = 'font-size:11px;color:#666;margin-top:2px;';
    descEl.textContent = cmd.description || '';

    item.appendChild(nameEl);
    if (cmd.description) item.appendChild(descEl);
    container.appendChild(item);
  });
}

// ============================================================
// SIDEBAR TABS
// ============================================================
document.querySelectorAll('.sidebar-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    var pane = this.dataset.pane;
    document.querySelectorAll('.sidebar-tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.sidebar-pane').forEach(function(p) { p.classList.remove('active'); });
    this.classList.add('active');
    var paneEl = $('pane-' + pane);
    if (paneEl) paneEl.classList.add('active');

    // Lazy load on first tab switch
    if (pane === 'apps') loadApps();
    else if (pane === 'skills') loadSkills();
    else if (pane === 'mcp') loadMcpServers();
    else if (pane === 'cmds') loadCommands();
  });
});

// ============================================================
// SIDEBAR TOGGLE
// ============================================================
$('sidebar-toggle').addEventListener('click', function() {
  $('sidebar').classList.toggle('collapsed');
});

// ============================================================
// INIT
// ============================================================
if (!ensureAuth()) {
  document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#888;">API key required. Refresh to try again.</div>';
} else {
  initMarked();
  checkHealth();
  setInterval(checkHealth, 30000);
  loadConversations();
  loadApps();
  setInterval(loadApps, 15000);
  subscribeApprovals();
  setupMainResizeHandle();
  loadLocalState();
  addSystemMsg('Welcome to Gemini CLI as a Service. Type a message to start.');
}
<\/script>
</body>
</html>`;

module.exports = webRoutes;
