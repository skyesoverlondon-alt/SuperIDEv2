function normalizeWorkspace(clientFiles = []) {
  const files = new Map();
  const meta = [];

  for (const raw of Array.isArray(clientFiles) ? clientFiles : []) {
    const path = typeof raw?.path === 'string' ? raw.path.trim().replace(/^\.\//, '') : '';
    if (!path) continue;
    const content = typeof raw?.content === 'string' ? raw.content : '';
    const binary = content.startsWith('__b64__:');
    const truncated = !!raw?.truncated;
    files.set(path, content);
    meta.push({
      path,
      bytes: content.length,
      binary,
      truncated,
      ext: extname(path),
      basename: base(path),
      tokensApprox: estimateTokens(content),
    });
  }

  meta.sort((a, b) => a.path.localeCompare(b.path));
  return { files, meta };
}

function estimateTokens(str = '') {
  return Math.max(1, Math.ceil(String(str).length / 4));
}

function extname(path = '') {
  const idx = String(path).lastIndexOf('.');
  return idx === -1 ? '' : String(path).slice(idx + 1).toLowerCase();
}

function base(path = '') {
  const clean = String(path).replace(/\\/g, '/');
  const parts = clean.split('/');
  return parts[parts.length - 1] || clean;
}

function dirname(path = '') {
  const clean = String(path).replace(/\\/g, '/');
  const parts = clean.split('/');
  parts.pop();
  return parts.join('/') || '.';
}

function isLikelyTextPath(path = '') {
  const ext = extname(path);
  if (!ext) return true;
  return !new Set([
    'png','jpg','jpeg','gif','webp','avif','ico','pdf','zip','gz','woff','woff2','ttf','eot','mp4','mov','webm','mp3','wav','ogg','exe','dll','so','dylib','bin','db'
  ]).has(ext);
}

function tokenizePrompt(prompt = '') {
  return Array.from(new Set(String(prompt)
    .toLowerCase()
    .replace(/[^a-z0-9_\-./ ]+/g, ' ')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s && s.length >= 2)));
}

function scorePathForPrompt(path = '', prompt = '') {
  const tokens = tokenizePrompt(prompt);
  const lowerPath = String(path).toLowerCase();
  const name = base(lowerPath);
  let score = 0;

  for (const token of tokens) {
    if (lowerPath.includes(token)) score += token.length > 4 ? 8 : 4;
    if (name === token) score += 12;
    if (name.startsWith(token)) score += 8;
  }

  if (/readme|package\.json|netlify\.toml|wrangler\.toml|manifest\.json|index\.html|ide\.html/.test(lowerPath)) score += 6;
  if (/app\.|editor\.|styles\.|ui\.|worker\//.test(lowerPath)) score += 4;
  if (/test|spec/.test(lowerPath) && /test|bug|fail|broken|error|fix/.test(String(prompt).toLowerCase())) score += 5;
  if (/security|auth|token|jwt|secret|quota|billing|stripe/.test(lowerPath) && /security|auth|token|jwt|secret|quota|billing|stripe/.test(String(prompt).toLowerCase())) score += 7;
  if (/intro|landing|theme|style|css|logo/.test(lowerPath) && /intro|landing|theme|style|css|logo|brand|pink|gold/.test(String(prompt).toLowerCase())) score += 7;

  return score;
}

function buildProjectMap(meta = [], maxLines = 140) {
  const lines = [];
  for (const file of meta) {
    if (lines.length >= maxLines) {
      lines.push(`... (${meta.length - maxLines} more files)`);
      break;
    }
    lines.push(`${file.path} | ${file.bytes}b${file.binary ? ' | binary' : ''}${file.truncated ? ' | truncated' : ''}`);
  }
  return lines.join('\n');
}

function pickContextFiles(meta = [], prompt = '', options = {}) {
  const depth = String(options.depth || 'balanced');
  const maxFiles = Number(options.maxFiles) || (depth === 'deep' ? 18 : depth === 'light' ? 8 : 12);
  const maxSnippetChars = Number(options.maxSnippetChars) || (depth === 'deep' ? 12000 : 7000);
  const allowed = [];
  const ranked = [];

  for (const file of meta) {
    if (file.binary || !isLikelyTextPath(file.path)) continue;
    const score = scorePathForPrompt(file.path, prompt);
    ranked.push({ ...file, score });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.path.split('/').length !== b.path.split('/').length) return a.path.split('/').length - b.path.split('/').length;
    return a.path.localeCompare(b.path);
  });

  const mustHave = new Set();
  for (const file of ranked) {
    if (/readme|package\.json|netlify\.toml|manifest\.json|index\.html|ide\.html/.test(file.path.toLowerCase())) mustHave.add(file.path);
  }

  for (const file of ranked) {
    if (mustHave.has(file.path) || file.score > 0) allowed.push(file);
    if (allowed.length >= maxFiles) break;
  }

  if (!allowed.length) {
    for (const file of ranked.slice(0, maxFiles)) allowed.push(file);
  }

  return { files: allowed.slice(0, maxFiles), maxSnippetChars };
}

function snippetForContent(content = '', maxChars = 7000) {
  const text = String(content || '');
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.78));
  const tail = text.slice(-Math.floor(maxChars * 0.18));
  return `${head}\n/* … truncated for context … */\n${tail}`;
}

function buildSeedContext({ files, meta }, prompt = '', options = {}) {
  const { files: picked, maxSnippetChars } = pickContextFiles(meta, prompt, options);
  const sections = [];
  for (const file of picked) {
    const raw = files.get(file.path) || '';
    sections.push(`FILE: ${file.path}\n${snippetForContent(raw, maxSnippetChars)}`);
  }
  return {
    selected: picked.map((f) => f.path),
    context: sections.join('\n\n---\n\n'),
  };
}

function summarizeWorkspace(meta = [], options = {}) {
  const count = meta.length;
  const textCount = meta.filter((f) => !f.binary && isLikelyTextPath(f.path)).length;
  const dirs = new Map();
  for (const file of meta) {
    const dir = dirname(file.path);
    dirs.set(dir, (dirs.get(dir) || 0) + 1);
  }
  const topDirs = Array.from(dirs.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(options.maxDirs) || 8)
    .map(([dir, n]) => `${dir} (${n})`);

  return [
    `Workspace files: ${count}`,
    `Text-ish files: ${textCount}`,
    topDirs.length ? `Top dirs: ${topDirs.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function sanitizeOperations(ops = []) {
  const cleaned = [];
  const seenDelete = new Set();
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || typeof op !== 'object' || !op.type) continue;
    if ((op.type === 'create' || op.type === 'update') && typeof op.path === 'string') {
      cleaned.push({ type: op.type, path: op.path, content: typeof op.content === 'string' ? op.content : '' });
      continue;
    }
    if (op.type === 'delete' && typeof op.path === 'string') {
      if (seenDelete.has(op.path)) continue;
      seenDelete.add(op.path);
      cleaned.push({ type: 'delete', path: op.path });
      continue;
    }
    if (op.type === 'rename' && typeof op.from === 'string' && typeof op.to === 'string') {
      cleaned.push({ type: 'rename', from: op.from, to: op.to });
    }
  }
  return cleaned;
}

module.exports = {
  normalizeWorkspace,
  estimateTokens,
  buildProjectMap,
  buildSeedContext,
  summarizeWorkspace,
  sanitizeOperations,
  tokenizePrompt,
  scorePathForPrompt,
  isLikelyTextPath,
};
