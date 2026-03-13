window.SKYE = {
  toast(message, kind = '') {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = `toast ${kind}`.trim();
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      setTimeout(() => el.remove(), 240);
    }, 3600);
  },
  formatBytes(bytes = 0) {
    const value = Number(bytes || 0);
    if (!value) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let idx = 0;
    let current = value;
    while (current >= 1024 && idx < units.length - 1) {
      current /= 1024;
      idx += 1;
    }
    return `${current.toFixed(current >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
  },
  formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }).format(date);
  },
  copy(text) {
    return navigator.clipboard.writeText(text).then(() => window.SKYE.toast('Copied.')).catch(() => window.SKYE.toast('Clipboard copy failed.', 'warn'));
  },
  mimeBadge(mime = '', name = '') {
    const lowerName = String(name || '').toLowerCase();
    const lower = String(mime || '').toLowerCase();
    if (lowerName.endsWith('.skye')) return 'SKYE';
    if (lower.includes('pdf')) return 'PDF';
    if (lower.includes('image/')) return 'Image';
    if (lower.includes('json') || lower.includes('javascript') || lower.includes('typescript')) return 'Code';
    if (lower.includes('html')) return 'HTML';
    if (lower.includes('markdown')) return 'Markdown';
    if (lower.includes('text/')) return 'Text';
    if (lower.includes('zip')) return 'Archive';
    return (lower.split('/').pop() || lowerName.split('.').pop() || 'File').slice(0, 16).toUpperCase();
  },
  setNav() {
    const pathname = window.location.pathname.replace(/\/+$|^$/g, '/');
    document.querySelectorAll('[data-nav]').forEach((link) => {
      const href = new URL(link.href, window.location.origin).pathname.replace(/\/+$|^$/g, '/');
      if (pathname === href) link.classList.add('active');
    });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.SKYE.setNav();
  const isFileProtocol = window.location.protocol === 'file:';
  const secureEnough = window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isFileProtocol && secureEnough && 'serviceWorker' in navigator) {
    const swPath = window.location.pathname.includes('/drive/') ? '../sw.js' : './sw.js';
    navigator.serviceWorker.register(swPath, { updateViaCache: 'none' }).catch(() => {});
  }
});
