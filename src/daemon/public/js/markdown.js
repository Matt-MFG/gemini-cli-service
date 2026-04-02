/**
 * Markdown rendering with syntax highlighting, widget detection,
 * and progressive rendering support.
 * Phase 3: Auto-resize iframes, error boundaries, language badges.
 */
import { escHtml } from './state.js';

export function initMarked() {
  if (typeof marked === 'undefined') return;

  const renderer = new marked.Renderer();

  renderer.code = function(code, lang) {
    const actualCode = (typeof code === 'object' && code !== null) ? (code.text || '') : String(code || '');
    const actualLang = (typeof code === 'object' && code !== null) ? (code.lang || '') : String(lang || '');

    // P3-39, P3-40: Inline widget rendering with sandbox and auto-resize
    if (actualLang === 'html:widget' || actualLang === 'svg:widget') {
      const iframeId = 'widget-' + Math.random().toString(36).slice(2);
      // Wrap in error boundary container
      return `<div class="widget-container">
        <iframe id="${iframeId}" class="widget-frame" sandbox="allow-scripts"
          srcdoc="${escHtml(wrapWidgetContent(actualCode, iframeId))}"
          style="min-height:200px;" onload="this.style.opacity=1"
          onerror="this.parentElement.innerHTML='<div class=widget-error>Widget failed to render</div>'">
        </iframe>
      </div>`;
    }

    // Syntax highlighting
    let highlighted = actualCode;
    if (typeof hljs !== 'undefined' && actualLang) {
      try {
        const validLang = hljs.getLanguage(actualLang) ? actualLang : 'plaintext';
        highlighted = hljs.highlight(actualCode, { language: validLang }).value;
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

    // Language badge on code blocks
    const langBadge = actualLang
      ? `<span class="code-lang-badge">${escHtml(actualLang)}</span>`
      : '';
    const langClass = actualLang
      ? ` class="hljs language-${escHtml(actualLang)}"`
      : ' class="hljs"';

    return `<div style="position:relative;">${langBadge}<pre><code${langClass}>${highlighted}</code></pre></div>`;
  };

  marked.setOptions({
    renderer,
    breaks: true,
    gfm: true,
  });
}

/**
 * P3-39: Wrap widget content with auto-resize postMessage script.
 */
function wrapWidgetContent(code, iframeId) {
  // For SVG widgets, wrap in a basic HTML page
  if (code.trim().startsWith('<svg')) {
    return `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;}</style></head><body>${code}<script>
      new ResizeObserver(()=>{
        parent.postMessage({type:'widget-resize',id:'${iframeId}',height:document.body.scrollHeight},'*');
      }).observe(document.body);
    <\/script></body></html>`;
  }

  // For HTML widgets, inject the resize observer
  if (code.includes('</body>')) {
    return code.replace('</body>', `<script>
      new ResizeObserver(()=>{
        parent.postMessage({type:'widget-resize',id:'${iframeId}',height:document.body.scrollHeight},'*');
      }).observe(document.body);
    <\/script></body>`);
  }

  // Fallback: wrap in HTML
  return `<!DOCTYPE html><html><head><style>body{margin:8px;font-family:sans-serif;}</style></head><body>${code}<script>
    new ResizeObserver(()=>{
      parent.postMessage({type:'widget-resize',id:'${iframeId}',height:document.body.scrollHeight},'*');
    }).observe(document.body);
  <\/script></body></html>`;
}

/**
 * Listen for widget resize messages and auto-resize iframes.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'widget-resize' && e.data.id) {
      const iframe = document.getElementById(e.data.id);
      if (iframe && e.data.height) {
        iframe.style.height = Math.min(e.data.height + 16, 600) + 'px';
      }
    }
  });
}

export function renderMarkdown(text) {
  if (typeof marked === 'undefined') return '<pre>' + escHtml(text) + '</pre>';
  try {
    return marked.parse(text || '');
  } catch(e) {
    return '<pre>' + escHtml(text) + '</pre>';
  }
}
