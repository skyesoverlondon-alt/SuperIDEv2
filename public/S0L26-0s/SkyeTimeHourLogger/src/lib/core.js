export function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatDuration(seconds = 0) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function formatMoney(cents = 0, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((Number(cents) || 0) / 100);
}

export function chunkLines(lines, size = 46) {
  const pages = [];
  for (let i = 0; i < lines.length; i += size) pages.push(lines.slice(i, i + size));
  return pages;
}

export function wrapLine(text = '', max = 92) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return [''];
  const words = raw.split(' ');
  const out = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= max) {
      line = next;
    } else {
      if (line) out.push(line);
      if (word.length > max) {
        for (let i = 0; i < word.length; i += max) out.push(word.slice(i, i + max));
        line = '';
      } else {
        line = word;
      }
    }
  }
  if (line) out.push(line);
  return out;
}

function pdfEscape(text = '') {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export function buildPdfFromLines(pagesInput, meta = {}) {
  const pages = pagesInput.length ? pagesInput : [['SkyeTime export is empty.']];
  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const fontRegular = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBold = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  const pageObjectIndexes = [];
  const contentObjectIndexes = [];

  pages.forEach((lines, pageIndex) => {
    const streamParts = [];
    streamParts.push('BT');
    streamParts.push(`/F2 18 Tf 48 760 Td (${pdfEscape(meta.title || 'SkyeTime: Hour Logger')}) Tj`);
    streamParts.push('0 -18 Td');
    streamParts.push(`/F1 9 Tf (${pdfEscape(meta.subtitle || 'Operator proof export')}) Tj`);
    streamParts.push('0 -16 Td');
    streamParts.push(`/F1 8 Tf (${pdfEscape(`Generated ${meta.generatedAt || ''}`)}) Tj`);
    streamParts.push('0 -18 Td');
    streamParts.push(`/F1 9 Tf (${pdfEscape(`Page ${pageIndex + 1} of ${pages.length}`)}) Tj`);
    streamParts.push('ET');

    let y = 680;
    for (const line of lines) {
      streamParts.push('BT');
      streamParts.push(`/F1 9 Tf 48 ${y} Td (${pdfEscape(line)}) Tj`);
      streamParts.push('ET');
      y -= 13;
      if (y < 48) break;
    }

    const stream = streamParts.join('\n');
    const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    contentObjectIndexes.push(contentId);
    const pageId = addObject(`<< /Type /Page /Parent __PAGES__ 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageObjectIndexes.push(pageId);
  });

  const pagesId = addObject(`<< /Type /Pages /Kids [${pageObjectIndexes.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIndexes.length} >>`);
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const infoId = addObject(`<< /Title (${pdfEscape(meta.title || 'SkyeTime: Hour Logger')}) /Author (${pdfEscape(meta.author || 'Skyes Over London LC')}) /Producer (${pdfEscape('SkyeTime Cloudflare Worker')}) /CreationDate (${pdfEscape(meta.creationDatePdf || '')}) >>`);

  for (const pageId of pageObjectIndexes) {
    objects[pageId - 1] = objects[pageId - 1].replace('__PAGES__', String(pagesId));
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
