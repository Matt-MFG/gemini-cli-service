/**
 * A2UI structured panel renderers for the web UI.
 */
import { $, escHtml, formatTime } from './state.js';

function scrollBottom() {
  const m = $('messages');
  m.scrollTop = m.scrollHeight;
}

export function renderA2uiPanel(template, data, label) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap assistant';

  const panel = document.createElement('div');
  panel.className = 'a2ui-panel';

  const header = document.createElement('div');
  header.className = 'a2ui-header';

  const body = document.createElement('div');
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
      const pre = document.createElement('pre');
      pre.style.cssText = 'font-size:11px;color:var(--color-text-muted);white-space:pre-wrap;word-wrap:break-word;';
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
  const results = Array.isArray(data) ? data : (data.results || []);
  const passing = results.filter(function(r) { return r.status === 'pass' || r.pass === true; }).length;
  const failing = results.length - passing;

  header.className = 'a2ui-header ' + (failing > 0 ? 'fail' : 'pass');
  header.textContent = (label || 'Test Results') + ' \u2014 ' + passing + ' passing, ' + failing + ' failing';

  const tbl = document.createElement('table');
  tbl.className = 'test-table';
  tbl.innerHTML = '<thead><tr><th></th><th>Test</th><th>Duration</th><th>Error</th></tr></thead>';
  const tbody = document.createElement('tbody');

  results.forEach(function(r) {
    const pass = r.status === 'pass' || r.pass === true;
    const tr = document.createElement('tr');
    const icon = document.createElement('td');
    icon.className = pass ? 'pass-icon' : 'fail-icon';
    icon.textContent = pass ? '\u2713' : '\u2717';
    const name = document.createElement('td');
    name.textContent = r.name || r.test || '';
    const dur = document.createElement('td');
    dur.textContent = r.duration ? formatTime(r.duration) : '';
    const err = document.createElement('td');
    err.style.cssText = 'color:var(--color-error);font-size:11px;font-family:var(--font-mono);';
    err.textContent = r.error || '';
    tr.appendChild(icon); tr.appendChild(name); tr.appendChild(dur); tr.appendChild(err);
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  body.appendChild(tbl);
}

function renderAppInventory(header, body, data, label) {
  header.textContent = label || 'App Inventory';
  const apps = Array.isArray(data) ? data : (data.apps || []);
  const grid = document.createElement('div');
  grid.className = 'app-inv-grid';

  apps.forEach(function(app) {
    const card = document.createElement('div');
    card.className = 'app-inv-card';

    const nameEl = document.createElement('div');
    nameEl.className = 'inv-name';
    const dot = document.createElement('span');
    dot.className = 'status-dot ' + (app.status || 'stopped');
    nameEl.appendChild(dot);
    nameEl.appendChild(document.createTextNode(app.name || ''));

    const urlEl = document.createElement('div');
    urlEl.className = 'inv-url';
    if (app.url) {
      const link = document.createElement('a');
      link.href = app.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = app.url;
      urlEl.appendChild(link);
    }

    const portEl = document.createElement('div');
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
  const items = Array.isArray(data) ? data : (data.items || []);
  const ul = document.createElement('ul');
  ul.className = 'sel-list';

  items.forEach(function(item) {
    const li = document.createElement('li');
    li.textContent = typeof item === 'string' ? item : (item.label || item.name || JSON.stringify(item));
    li.addEventListener('click', function() {
      const val = typeof item === 'string' ? item : (item.value || item.name || item.label);
      // Dispatch a custom event so chat.js can handle the send
      document.dispatchEvent(new CustomEvent('a2ui-selection', { detail: String(val) }));
    });
    ul.appendChild(li);
  });
  body.appendChild(ul);
}

function renderTokenUsage(header, body, data, label) {
  header.textContent = (data.summary ? data.summary : (label || 'Token Usage'));
  const grid = document.createElement('div');
  grid.className = 'token-grid';

  if (data.metrics && Array.isArray(data.metrics)) {
    data.metrics.forEach(function(m) {
      const card = document.createElement('div');
      card.className = 'token-card';
      const val = document.createElement('div');
      val.className = 'token-val';
      val.textContent = m.value || '0';
      const lbl = document.createElement('div');
      lbl.className = 'token-label';
      lbl.textContent = m.label || '';
      card.appendChild(val); card.appendChild(lbl);
      grid.appendChild(card);
    });
  } else {
    const fields = [
      {key: 'input_tokens', label: 'Input'},
      {key: 'output_tokens', label: 'Output'},
      {key: 'cache_read_tokens', label: 'Cached'},
      {key: 'total_tokens', label: 'Total'},
      {key: 'cost_usd', label: 'Cost', fmt: function(v) { return '$' + Number(v).toFixed(4); }},
    ];
    fields.forEach(function(f) {
      if (data[f.key] == null) return;
      const card = document.createElement('div');
      card.className = 'token-card';
      const val = document.createElement('div');
      val.className = 'token-val';
      val.textContent = f.fmt ? f.fmt(data[f.key]) : Number(data[f.key]).toLocaleString();
      const lbl = document.createElement('div');
      lbl.className = 'token-label';
      lbl.textContent = f.label;
      card.appendChild(val); card.appendChild(lbl);
      grid.appendChild(card);
    });
  }
  body.appendChild(grid);
}

function renderFileChanges(header, body, data, label) {
  header.textContent = label || 'File Changes';
  const lines = Array.isArray(data) ? data : (data.lines || String(data).split('\n'));
  const container = document.createElement('div');
  container.style.cssText = 'max-height:400px;overflow-y:auto;border-radius:var(--radius-sm);background:var(--color-surface-recessed);padding:var(--space-1) 0;';

  lines.forEach(function(line) {
    const el = document.createElement('div');
    el.className = 'diff-line';
    const s = typeof line === 'string' ? line : (line.text || String(line));
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
  const rows = Array.isArray(data) ? data : (data.rows || []);
  if (!rows.length) { body.textContent = 'No data.'; return; }

  const cols = data.columns || Object.keys(rows[0]);
  let sortCol = null;
  let sortDir = 1;

  const tbl = document.createElement('table');
  tbl.className = 'generic-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');

  cols.forEach(function(col) {
    const th = document.createElement('th');
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

  const tbody = document.createElement('tbody');
  tbl.appendChild(tbody);

  function renderRows() {
    tbody.innerHTML = '';
    const sorted = rows.slice();
    if (sortCol) {
      sorted.sort(function(a, b) {
        const av = a[sortCol]; const bv = b[sortCol];
        if (av < bv) return -sortDir;
        if (av > bv) return sortDir;
        return 0;
      });
    }
    sorted.forEach(function(row) {
      const tr = document.createElement('tr');
      cols.forEach(function(col) {
        const td = document.createElement('td');
        td.textContent = row[col] != null ? row[col] : '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  renderRows();
  body.appendChild(tbl);
}

export function detectTestPattern(text) {
  return /\d+\s+passing|\d+\s+failing|PASS|FAIL/.test(text || '');
}
