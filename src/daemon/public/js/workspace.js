/**
 * Workspace layout — flexible panel docking, persistence, resize.
 * Phase 3: P3-62 through P3-65
 */
import { state, $ } from './state.js';

const LAYOUT_KEY_PREFIX = 'workspace-layout-';

/**
 * Save the current workspace layout for a conversation.
 * P3-64: Layout persists per conversation.
 */
export function saveLayout() {
  const key = LAYOUT_KEY_PREFIX + (state.conversationId || 'default');
  const layout = {
    sidebarCollapsed: $('sidebar')?.classList.contains('collapsed') || false,
    explorerVisible: $('file-explorer-panel')?.style.display !== 'none',
    rightPanelWidth: state.rightPanelWidth,
    panels: state.panels.map(p => ({ id: p.id, name: p.name, url: p.url })),
  };

  try {
    localStorage.setItem(key, JSON.stringify(layout));
  } catch { /* ignore */ }
}

/**
 * Restore workspace layout for a conversation.
 * P3-65: Panels show/hide without losing state.
 */
export function restoreLayout() {
  const key = LAYOUT_KEY_PREFIX + (state.conversationId || 'default');

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;

    const layout = JSON.parse(raw);

    // Restore sidebar state
    const sidebar = $('sidebar');
    if (sidebar && layout.sidebarCollapsed) {
      sidebar.classList.add('collapsed');
    } else if (sidebar) {
      sidebar.classList.remove('collapsed');
    }

    // Restore panel width
    if (layout.rightPanelWidth) {
      state.rightPanelWidth = layout.rightPanelWidth;
    }

    // Restore file explorer
    const explorer = $('file-explorer-panel');
    if (explorer) {
      explorer.style.display = layout.explorerVisible ? 'flex' : 'none';
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * P3-63: Make a panel resizable via drag.
 */
export function makeResizable(handle, getTarget, options = {}) {
  const { direction = 'horizontal', min = 200, max = 800, onResize } = options;
  let startPos, startSize;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const target = getTarget();
    if (!target) return;

    startPos = direction === 'horizontal' ? e.clientX : e.clientY;
    startSize = direction === 'horizontal' ? target.offsetWidth : target.offsetHeight;
    handle.classList.add('dragging');

    const onMove = (e) => {
      const delta = (direction === 'horizontal' ? e.clientX : e.clientY) - startPos;
      const newSize = Math.max(min, Math.min(max, startSize + delta));
      target.style[direction === 'horizontal' ? 'width' : 'height'] = newSize + 'px';
      if (onResize) onResize(newSize);
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      saveLayout();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/**
 * Initialize workspace layout on page load.
 */
export function initWorkspace() {
  // Try to restore saved layout
  restoreLayout();

  // Save layout when panels change
  const observer = new MutationObserver(() => saveLayout());
  const rightPanels = $('right-panels');
  if (rightPanels) {
    observer.observe(rightPanels, { childList: true, subtree: false });
  }
}
