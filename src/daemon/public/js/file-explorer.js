/**
 * File Explorer panel — tree view with preview, breadcrumbs,
 * and agent integration.
 * Phase 3: P3-51 through P3-57
 */
import { $, authFetch, escHtml } from './state.js';
import { sendText } from './chat.js';

let currentPath = '';
let explorerVisible = false;

/**
 * Toggle the file explorer panel.
 */
export function toggleExplorer() {
  const panel = $('file-explorer-panel');
  if (!panel) return;

  explorerVisible = !explorerVisible;
  panel.style.display = explorerVisible ? 'flex' : 'none';

  if (explorerVisible && !currentPath) {
    navigateTo('/home');
  }
}

/**
 * Navigate to a directory and render the tree.
 */
export async function navigateTo(dirPath) {
  currentPath = dirPath;
  const container = $('explorer-tree');
  const breadcrumbs = $('explorer-breadcrumbs');
  if (!container) return;

  container.innerHTML = '<div class="empty-state">Loading...</div>';

  try {
    const r = await authFetch('/files/tree?path=' + encodeURIComponent(dirPath) + '&depth=1');
    const d = await r.json();

    // P3-53: Breadcrumbs
    if (breadcrumbs && d.breadcrumbs) {
      breadcrumbs.innerHTML = '';
      d.breadcrumbs.forEach((crumb, i) => {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'breadcrumb-sep';
          sep.textContent = '/';
          breadcrumbs.appendChild(sep);
        }
        const btn = document.createElement('button');
        btn.className = 'breadcrumb-item';
        btn.textContent = crumb.name;
        btn.addEventListener('click', () => navigateTo(crumb.path));
        breadcrumbs.appendChild(btn);
      });
    }

    // Render tree
    container.innerHTML = '';
    if (!d.children || !d.children.length) {
      container.innerHTML = '<div class="empty-state">Empty directory</div>';
      return;
    }

    for (const node of d.children) {
      container.appendChild(createTreeNode(node));
    }
  } catch (err) {
    container.innerHTML = '<div class="empty-state">Error: ' + escHtml(err.message) + '</div>';
  }
}

/**
 * Create a tree node element.
 */
function createTreeNode(node) {
  const item = document.createElement('div');
  item.className = 'tree-item';

  const row = document.createElement('div');
  row.className = 'tree-row';

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = node.type === 'directory' ? '\uD83D\uDCC1' : getFileIcon(node.ext);

  const name = document.createElement('span');
  name.className = 'tree-name';
  name.textContent = node.name;

  if (node.type === 'file' && node.size != null) {
    const size = document.createElement('span');
    size.className = 'tree-size';
    size.textContent = formatBytes(node.size);
    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(size);
  } else {
    row.appendChild(icon);
    row.appendChild(name);
  }

  item.appendChild(row);

  if (node.type === 'directory') {
    row.addEventListener('click', () => navigateTo(node.path));
  } else {
    row.addEventListener('click', () => previewFile(node.path));

    // P3-54: Right-click context menu for agent integration
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showFileContextMenu(e.clientX, e.clientY, node);
    });
  }

  // Render children if expanded
  if (node.children && node.children.length) {
    const childContainer = document.createElement('div');
    childContainer.className = 'tree-children';
    for (const child of node.children) {
      childContainer.appendChild(createTreeNode(child));
    }
    item.appendChild(childContainer);
  }

  return item;
}

/**
 * P3-52: Preview a file.
 */
async function previewFile(filePath) {
  const preview = $('explorer-preview');
  if (!preview) return;

  preview.innerHTML = '<div class="empty-state">Loading...</div>';

  try {
    const r = await authFetch('/files/preview?path=' + encodeURIComponent(filePath));
    const d = await r.json();

    preview.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'preview-header';
    header.innerHTML = `<span class="preview-name">${escHtml(d.name)}</span><span class="preview-size">${formatBytes(d.size)}</span>`;
    preview.appendChild(header);

    if (d.type === 'image') {
      const img = document.createElement('img');
      img.className = 'preview-image';
      img.src = d.dataUri;
      img.alt = d.name;
      preview.appendChild(img);
    } else if (d.type === 'text') {
      const code = document.createElement('pre');
      code.className = 'preview-code';
      if (typeof hljs !== 'undefined' && d.language) {
        try {
          const lang = hljs.getLanguage(d.language) ? d.language : 'plaintext';
          code.innerHTML = '<code class="hljs">' + hljs.highlight(d.content, { language: lang }).value + '</code>';
        } catch {
          code.textContent = d.content;
        }
      } else {
        code.textContent = d.content;
      }
      preview.appendChild(code);
    } else if (d.type === 'binary') {
      preview.innerHTML += '<div class="empty-state">Binary file (' + d.language + ')</div>';
    } else if (d.type === 'large') {
      preview.innerHTML += '<div class="empty-state">File too large for preview</div>';
    }

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'preview-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn-sm';
    downloadBtn.textContent = 'Download';
    downloadBtn.addEventListener('click', () => {
      window.open('/files/download?path=' + encodeURIComponent(filePath), '_blank');
    });

    const reviewBtn = document.createElement('button');
    reviewBtn.className = 'btn-sm';
    reviewBtn.textContent = 'Ask agent to review';
    reviewBtn.addEventListener('click', () => {
      sendText('Review the file at ' + filePath);
    });

    actions.appendChild(downloadBtn);
    actions.appendChild(reviewBtn);
    preview.appendChild(actions);
  } catch (err) {
    preview.innerHTML = '<div class="empty-state">Error: ' + escHtml(err.message) + '</div>';
  }
}

/**
 * P3-54: File context menu for agent integration.
 */
function showFileContextMenu(x, y, node) {
  const menu = $('ctx-menu');
  if (!menu) return;

  menu.innerHTML = '';
  const items = [
    { label: 'Preview', action: () => previewFile(node.path) },
    { label: 'Review this file', action: () => sendText('Review the file at ' + node.path) },
    { label: 'Explain this file', action: () => sendText('Explain what ' + node.path + ' does') },
    { sep: true },
    { label: 'Download', action: () => window.open('/files/download?path=' + encodeURIComponent(node.path), '_blank') },
  ];

  items.forEach(item => {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-sep';
      menu.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
    el.className = 'context-menu-item';
    el.textContent = item.label;
    el.addEventListener('click', () => { menu.style.display = 'none'; item.action(); });
    menu.appendChild(el);
  });

  menu.style.display = 'block';
  menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 10) + 'px';
}

function getFileIcon(ext) {
  const icons = {
    js: '\uD83D\uDFE8', ts: '\uD83D\uDD35', py: '\uD83D\uDC0D', go: '\uD83D\uDD35',
    json: '{ }', yml: '\u2699', yaml: '\u2699', md: '\uD83D\uDCDD',
    html: '\uD83C\uDF10', css: '\uD83C\uDFA8', sql: '\uD83D\uDDC3',
    sh: '\uD83D\uDCBB', bash: '\uD83D\uDCBB',
  };
  return icons[ext] || '\uD83D\uDCC4';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}
