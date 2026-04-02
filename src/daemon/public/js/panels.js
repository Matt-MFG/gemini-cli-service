/**
 * Right panels (embedded app iframes), app drawer, and sidebar management.
 */
import { state, $, escHtml, authFetch, saveLocalState } from './state.js';
import { addSystemMsg, sendText } from './chat.js';

// ============================================================
// RIGHT PANELS — Glassmorphic toolbar + tabs (P3-41, P3-42, P3-43)
// ============================================================
let activeTabId = null;

function renderPanels() {
  const container = $('right-panels');
  container.innerHTML = '';

  const mainHandle = $('main-resize-handle');
  if (!state.panels.length) {
    if (mainHandle) mainHandle.classList.remove('visible');
    container.style.width = '';
    return;
  }
  if (mainHandle) mainHandle.classList.add('visible');

  const panelWidth = Math.min(state.rightPanelWidth, Math.floor(window.innerWidth * 0.45));
  container.style.width = panelWidth + 'px';

  // Ensure we have an active tab
  if (!activeTabId || !state.panels.find(p => p.id === activeTabId)) {
    activeTabId = state.panels[0].id;
  }

  // P3-41: Glassmorphic toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'panel-toolbar glass';

  // P3-42: Tab navigation for multiple apps
  if (state.panels.length > 1) {
    const tabs = document.createElement('div');
    tabs.className = 'panel-tabs';

    state.panels.forEach(p => {
      const tab = document.createElement('button');
      tab.className = 'panel-tab' + (p.id === activeTabId ? ' active' : '');
      tab.textContent = p.name;
      tab.title = p.url;
      tab.addEventListener('click', () => {
        activeTabId = p.id;
        renderPanels(); // Re-render with crossfade
      });
      tabs.appendChild(tab);
    });

    toolbar.appendChild(tabs);
  } else {
    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = state.panels[0].name;
    title.title = state.panels[0].url;
    toolbar.appendChild(title);
  }

  // Toolbar buttons
  const actions = document.createElement('div');
  actions.className = 'panel-toolbar-actions';

  const expandBtn = document.createElement('button');
  expandBtn.className = 'btn-icon';
  expandBtn.title = 'Open in tab';
  expandBtn.textContent = '\u2197';
  expandBtn.addEventListener('click', () => {
    const active = state.panels.find(p => p.id === activeTabId);
    if (active) window.open(active.url, '_blank', 'noopener,noreferrer');
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-icon';
  closeBtn.title = 'Close';
  closeBtn.textContent = '\u2715';
  closeBtn.addEventListener('click', () => closePanel(activeTabId));

  actions.appendChild(expandBtn);
  actions.appendChild(closeBtn);
  toolbar.appendChild(actions);

  container.appendChild(toolbar);

  // P3-43: Render iframe for active tab with crossfade
  const activePanel = state.panels.find(p => p.id === activeTabId);
  if (activePanel) {
    const iframe = document.createElement('iframe');
    iframe.className = 'panel-iframe';
    iframe.src = activePanel.url;
    iframe.title = activePanel.name;
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    iframe.style.animation = 'fadeIn 300ms ease-out';
    container.appendChild(iframe);
  }

  saveLocalState();
}

export function openPanel(id, name, url) {
  if (state.panels.length >= 2) return;
  if (state.panels.find(function(p) { return p.id === id; })) return;
  state.panels.push({id, name, url});
  renderPanels();
}

function closePanel(id) {
  state.panels = state.panels.filter(function(p) { return p.id !== id; });
  renderPanels();
  if (!state.panels.length) {
    $('right-panels').style.width = '';
    const mainHandle = $('main-resize-handle');
    if (mainHandle) mainHandle.classList.remove('visible');
  }
  saveLocalState();
}

function setupResizeHandle(handle, container) {
  let startX, startW;
  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    startX = e.clientX;
    startW = state.rightPanelWidth;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  function onMove(e) {
    const dx = startX - e.clientX;
    state.rightPanelWidth = Math.max(240, Math.min(800, startW + dx));
    const panels = container.querySelectorAll('.right-panel');
    panels.forEach(function(p) { p.style.width = state.rightPanelWidth + 'px'; });
    container.style.width = (state.rightPanelWidth * state.panels.length + (state.panels.length - 1) * 5) + 'px';
  }
  function onUp() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
}

export function setupMainResizeHandle() {
  const handle = $('main-resize-handle');
  if (!handle) return;
  let startX, startW;
  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    startX = e.clientX;
    startW = state.rightPanelWidth;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onMainMove);
    document.addEventListener('mouseup', onMainUp);
  });
  function onMainMove(e) {
    const dx = startX - e.clientX;
    const maxW = Math.floor(window.innerWidth * 0.6);
    state.rightPanelWidth = Math.max(240, Math.min(maxW, startW + dx));
    const container = $('right-panels');
    const panels = container.querySelectorAll('.right-panel');
    panels.forEach(function(p) { p.style.width = state.rightPanelWidth + 'px'; });
    container.style.width = (state.rightPanelWidth * state.panels.length + (state.panels.length - 1) * 5) + 'px';
  }
  function onMainUp() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMainMove);
    document.removeEventListener('mouseup', onMainUp);
  }
}

export function loadLocalState() {
  try {
    const key = 'panels-' + (state.conversationId || 'default');
    const raw = localStorage.getItem(key);
    if (raw) {
      const panels = JSON.parse(raw);
      panels.forEach(function(p) { openPanel(p.id, p.name, p.url); });
    }
  } catch(e) { /* ignore */ }
}

// ============================================================
// APP DRAWER
// ============================================================
export async function loadApps() {
  try {
    const r = await authFetch('/apps?user_id=' + state.userId);
    const d = await r.json();
    state.apps = d.apps || d || [];
    renderAppList();
  } catch(e) { /* ignore */ }
}

function renderAppList() {
  const container = $('app-list');
  container.innerHTML = '';

  const filtered = state.apps.filter(function(app) {
    if (state.appFilter === 'all') return true;
    if (state.appFilter === 'running') return app.status === 'running';
    if (state.appFilter === 'stopped') return app.status !== 'running';
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state">No apps found.</div>';
    return;
  }

  const groups = {};
  const ungrouped = [];

  filtered.forEach(function(app) {
    const groupName = state.appGroups[app.name];
    if (groupName) {
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(app);
    } else {
      ungrouped.push(app);
    }
  });

  Object.keys(groups).forEach(function(groupName) {
    const ghdr = document.createElement('div');
    ghdr.className = 'app-group-header';
    ghdr.innerHTML = '&#9654; ' + escHtml(groupName);
    const groupContainer = document.createElement('div');

    ghdr.addEventListener('click', function() {
      const expanded = groupContainer.style.display !== 'none';
      groupContainer.style.display = expanded ? 'none' : '';
      ghdr.innerHTML = (expanded ? '&#9654; ' : '&#9660; ') + escHtml(groupName);
    });

    container.appendChild(ghdr);
    groups[groupName].forEach(function(app) {
      groupContainer.appendChild(createAppCard(app));
    });
    container.appendChild(groupContainer);
  });

  ungrouped.forEach(function(app) {
    container.appendChild(createAppCard(app));
  });
}

function createAppCard(app) {
  const card = document.createElement('div');
  card.className = 'app-card';
  card.draggable = true;
  card.dataset.appName = app.name;

  const nameEl = document.createElement('div');
  nameEl.className = 'app-name';
  const dot = document.createElement('span');
  dot.className = 'status-dot ' + (app.status || 'stopped');
  nameEl.appendChild(dot);
  nameEl.appendChild(document.createTextNode(app.name));

  const urlEl = document.createElement('div');
  urlEl.className = 'app-url';
  if (app.url) {
    const link = document.createElement('a');
    link.href = app.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = app.url;
    link.addEventListener('click', function(e) { e.stopPropagation(); });
    urlEl.appendChild(link);
  }

  const metaEl = document.createElement('div');
  metaEl.className = 'app-meta';
  if (app.lastModified) metaEl.textContent = 'Updated: ' + new Date(app.lastModified).toLocaleString();

  card.appendChild(nameEl);
  card.appendChild(urlEl);
  card.appendChild(metaEl);

  card.addEventListener('click', function() {
    if (app.url) openPanel(app.name, app.name, app.url);
  });

  card.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, app);
  });

  card.addEventListener('dragstart', function(e) {
    e.dataTransfer.setData('text/plain', app.name);
  });
  card.addEventListener('dragover', function(e) { e.preventDefault(); });
  card.addEventListener('drop', function(e) {
    e.preventDefault();
    const dragged = e.dataTransfer.getData('text/plain');
    if (dragged && dragged !== app.name) {
      const group = state.appGroups[app.name] || app.name + '-group';
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
  const menu = $('ctx-menu');
  menu.innerHTML = '';

  const items = [
    {label: 'Open in Panel', action: function() { if (app.url) openPanel(app.name, app.name, app.url); }},
    {label: 'Open in Tab', action: function() { if (app.url) window.open(app.url, '_blank', 'noopener,noreferrer'); }},
    {label: 'Go to Conversation', action: function() {
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
      const sep = document.createElement('div');
      sep.className = 'context-menu-sep';
      menu.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
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
  const menu = $('ctx-menu');
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

// ============================================================
// SKILLS
// ============================================================
export async function loadSkills() {
  try {
    const r = await authFetch('/skills');
    const d = await r.json();
    state.skills = d.skills || d || [];
    renderSkills();
  } catch(e) { /* ignore */ }
}

function renderSkills() {
  const container = $('skills-list');
  container.innerHTML = '';

  if (!state.skills.length) {
    container.innerHTML = '<div class="empty-state">No skills found.</div>';
    return;
  }

  state.skills.forEach(function(skill) {
    const item = document.createElement('div');
    item.className = 'skill-item';

    const info = document.createElement('div');
    info.style.flex = '1';
    const nameEl = document.createElement('div');
    nameEl.className = 'skill-name';
    nameEl.textContent = skill.name;
    const descEl = document.createElement('div');
    descEl.className = 'skill-desc';
    descEl.textContent = skill.description || '';
    info.appendChild(nameEl);
    info.appendChild(descEl);

    const label = document.createElement('label');
    label.className = 'toggle-switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = skill.enabled !== false;

    const track = document.createElement('span');
    track.className = 'toggle-track';

    const thumb = document.createElement('span');
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
  } catch(e) { /* ignore */ }
}

// ============================================================
// MCP SERVERS
// ============================================================
export async function loadMcpServers() {
  try {
    const r = await authFetch('/mcp-servers');
    const d = await r.json();
    state.mcpServers = d.servers || d || [];
    renderMcpServers();
  } catch(e) { /* ignore */ }
}

function renderMcpServers() {
  const container = $('mcp-list');
  container.innerHTML = '';

  if (!state.mcpServers.length) {
    container.innerHTML = '<div class="empty-state">No MCP servers configured.</div>';
    return;
  }

  state.mcpServers.forEach(function(srv) {
    const item = document.createElement('div');
    item.className = 'mcp-item';

    const nameEl = document.createElement('div');
    nameEl.className = 'mcp-name';
    const dot = document.createElement('span');
    dot.className = 'status-dot ' + (srv.status === 'connected' ? 'running' : (srv.status === 'error' ? 'error' : 'stopped'));
    nameEl.appendChild(dot);
    nameEl.appendChild(document.createTextNode(srv.name));

    const toolsEl = document.createElement('div');
    toolsEl.className = 'mcp-tools';
    toolsEl.textContent = (srv.toolCount || 0) + ' tools | ' + (srv.status || 'unknown');

    const actions = document.createElement('div');
    actions.className = 'mcp-actions';

    const testBtn = document.createElement('button');
    testBtn.className = 'btn-sm';
    testBtn.textContent = 'Test';
    (function(name) {
      testBtn.addEventListener('click', function() { testMcpServer(name); });
    })(srv.name);

    const delBtn = document.createElement('button');
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
    const r = await authFetch('/mcp-servers/' + encodeURIComponent(name) + '/test', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
    const d = await r.json();
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

// ============================================================
// COMMANDS
// ============================================================
export async function loadCommands() {
  try {
    const r = await authFetch('/commands');
    const d = await r.json();
    state.commands = d.commands || d || [];
    renderCommands();
  } catch(e) { /* ignore */ }
}

function renderCommands() {
  const container = $('cmds-list');
  container.innerHTML = '';

  if (!state.commands.length) {
    container.innerHTML = '<div class="empty-state">No commands found.</div>';
    return;
  }

  state.commands.forEach(function(cmd) {
    const item = document.createElement('div');
    item.className = 'cmd-item';

    const nameEl = document.createElement('div');
    nameEl.className = 'cmd-name';
    nameEl.textContent = '/' + (cmd.name || cmd);

    const descEl = document.createElement('div');
    descEl.style.cssText = 'font-size:11px;color:var(--color-text-muted);margin-top:2px;';
    descEl.textContent = cmd.description || '';

    item.appendChild(nameEl);
    if (cmd.description) item.appendChild(descEl);
    container.appendChild(item);
  });
}

// ============================================================
// MCP MODAL
// ============================================================
export function initMcpModal() {
  $('add-mcp-btn').addEventListener('click', function() {
    $('mcp-modal').classList.remove('hidden');
    $('mcp-name').focus();
  });

  $('mcp-cancel').addEventListener('click', function() {
    $('mcp-modal').classList.add('hidden');
  });

  $('mcp-save').addEventListener('click', async function() {
    const name = $('mcp-name').value.trim();
    const cmd = $('mcp-cmd').value.trim();
    const argsRaw = $('mcp-args').value.trim();
    const envRaw = $('mcp-env').value.trim();

    if (!name || !cmd) { alert('Name and command are required.'); return; }

    const args = argsRaw ? argsRaw.split(',').map(function(s) { return s.trim(); }) : [];
    const env = {};
    envRaw.split('\n').forEach(function(line) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    });

    try {
      await authFetch('/mcp-servers', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name, command: cmd, args, env}),
      });
      $('mcp-modal').classList.add('hidden');
      $('mcp-name').value = '';
      $('mcp-cmd').value = '';
      $('mcp-args').value = '';
      $('mcp-env').value = '';
      loadMcpServers();
    } catch(e) { addSystemMsg('Error adding MCP server: ' + e.message); }
  });

  $('mcp-modal').addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });
}

// ============================================================
// FILTER BUTTONS
// ============================================================
export function initFilterButtons() {
  document.querySelectorAll('.app-filter-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      state.appFilter = this.dataset.filter;
      document.querySelectorAll('.app-filter-btn').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      renderAppList();
    });
  });
}
