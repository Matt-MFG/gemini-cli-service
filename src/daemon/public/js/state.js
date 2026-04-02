/**
 * Global application state and utility functions.
 */

export const state = {
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
export function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function $(id) {
  return document.getElementById(id);
}

export function authFetch(url, opts) {
  opts = opts || {};
  if (!opts.headers) opts.headers = {};
  opts.headers['X-API-Key'] = state.apiKey;
  return fetch(url, opts);
}

export function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

export function formatTime(ms) {
  if (!ms) return '';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

export function saveLocalState() {
  try {
    const panels = state.panels.map(function(p) { return {id: p.id, name: p.name, url: p.url}; });
    localStorage.setItem('panels-' + (state.conversationId || 'default'), JSON.stringify(panels));
    localStorage.setItem('appGroups', JSON.stringify(state.appGroups));
  } catch(e) { /* ignore */ }
}

export async function ensureAuth() {
  // If we have a stored key, verify it still works
  if (state.apiKey && state.apiKey !== 'none') {
    try {
      const test = await fetch('/conversations/list?user_id=web-user', {
        headers: { 'X-API-Key': state.apiKey },
      });
      if (test.ok || test.status !== 401) return true;
    } catch { /* fall through to re-prompt */ }
    // Stored key is invalid — clear and re-prompt
    state.apiKey = '';
    sessionStorage.removeItem('apiKey');
  }

  // Check if server requires auth at all
  try {
    const test = await fetch('/conversations/list?user_id=web-user');
    if (test.ok || test.status !== 401) {
      state.apiKey = 'no-auth';
      return true;
    }
  } catch { /* server not reachable */ }

  // Server requires auth — prompt user
  state.apiKey = prompt('Enter API key:');
  if (!state.apiKey) return false;
  sessionStorage.setItem('apiKey', state.apiKey);
  return true;
}
