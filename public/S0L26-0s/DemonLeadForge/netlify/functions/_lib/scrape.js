import * as cheerio from 'cheerio';
import { uniqueStrings, toTitleCase } from './http.js';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g;
const ADDRESS_HINT_RE = /\d{1,6}\s+[A-Za-z0-9.#\-\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Suite|Ste|Drive|Dr|Lane|Ln|Way|Court|Ct|Circle|Cir)\b.*?(?:\d{5}(?:-\d{4})?)?/i;
const PRIORITY_KEYWORDS = ['directory', 'listing', 'profile', 'member', 'business', 'company', 'location', 'contact', 'about', 'team'];

function normalizeWhitespace(text = '') {
  return String(text).replace(/\s+/g, ' ').trim();
}

function safeUrl(input, base = undefined) {
  try {
    return new URL(input, base);
  } catch {
    return null;
  }
}

function sameOrigin(a, b) {
  return a?.origin && b?.origin && a.origin === b.origin;
}

function scoreLink(url) {
  const path = `${url.pathname} ${url.search}`.toLowerCase();
  return PRIORITY_KEYWORDS.reduce((score, keyword) => score + (path.includes(keyword) ? 2 : 0), 0);
}

function cleanPhone(phone) {
  return normalizeWhitespace(phone).replace(/[^\d()+\-\s.]/g, '').trim();
}

function cleanEmail(email) {
  return String(email).trim().replace(/[),.;]+$/, '').toLowerCase();
}

function extractJsonLdBusinesses($) {
  const rows = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed['@graph'])
          ? parsed['@graph']
          : [parsed];

      for (const node of nodes) {
        const type = Array.isArray(node['@type']) ? node['@type'].join(' ') : node['@type'] || '';
        if (!/organization|localbusiness|store|medicalbusiness|professionalservice|attorney|restaurant|dentist|auto/i.test(type)) continue;
        const emails = uniqueStrings([].concat(node.email || [], node.contactPoint?.email || []).flat().map(cleanEmail));
        const phones = uniqueStrings([].concat(node.telephone || [], node.contactPoint?.telephone || []).flat().map(cleanPhone));
        const websites = uniqueStrings([node.url].filter(Boolean));
        const address = typeof node.address === 'string'
          ? node.address
          : [node.address?.streetAddress, node.address?.addressLocality, node.address?.addressRegion, node.address?.postalCode]
              .filter(Boolean)
              .join(', ');

        rows.push({
          business_name: normalizeWhitespace(node.name || ''),
          contact_name: normalizeWhitespace(node.founder?.name || node.employee?.name || node.contactPoint?.name || ''),
          emails,
          phones,
          websites,
          address: normalizeWhitespace(address || ''),
          notes: 'Extracted from JSON-LD business schema.',
          raw_jsonld: node
        });
      }
    } catch {
      // ignore malformed blocks
    }
  });
  return rows;
}

function guessBusinessName($, url) {
  const candidates = [
    $('meta[property="og:site_name"]').attr('content'),
    $('meta[name="application-name"]').attr('content'),
    $('h1').first().text(),
    $('title').text(),
    url.hostname.replace(/^www\./, '')
  ].filter(Boolean).map(normalizeWhitespace);

  return toTitleCase(candidates[0] || 'Unnamed Lead');
}

function extractPageLead($, pageUrl) {
  const html = $.html();
  const text = normalizeWhitespace($('body').text() || '');
  const emails = uniqueStrings([
    ...((html.match(EMAIL_RE) || []).map(cleanEmail)),
    ...$('a[href^="mailto:"]').map((_, el) => cleanEmail($(el).attr('href').replace(/^mailto:/i, ''))).get()
  ]);
  const phones = uniqueStrings([
    ...((html.match(PHONE_RE) || []).map(cleanPhone)),
    ...$('a[href^="tel:"]').map((_, el) => cleanPhone($(el).attr('href').replace(/^tel:/i, ''))).get()
  ]);
  const websites = uniqueStrings([
    pageUrl.href,
    ...$('a[href]').map((_, el) => safeUrl($(el).attr('href'), pageUrl.href)?.href).get().filter(Boolean)
      .filter((href) => safeUrl(href)?.hostname === pageUrl.hostname)
      .slice(0, 10)
  ]);
  const address = normalizeWhitespace((text.match(ADDRESS_HINT_RE) || [])[0] || '');
  const pageTitle = normalizeWhitespace($('title').text() || '');

  return {
    business_name: guessBusinessName($, pageUrl),
    contact_name: '',
    emails,
    phones,
    websites,
    address,
    page_title: pageTitle,
    source_url: pageUrl.href,
    notes: 'Extracted from page-level public contact signals.',
    raw_jsonld: null
  };
}

function dedupeRows(rows = []) {
  const seen = new Map();

  for (const row of rows) {
    const key = [
      (row.business_name || '').toLowerCase().trim(),
      (row.emails?.[0] || '').toLowerCase().trim(),
      (row.phones?.[0] || '').replace(/\D/g, ''),
      (row.source_url || '').toLowerCase().trim()
    ].join('|');

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, {
        ...row,
        emails: uniqueStrings(row.emails || []),
        phones: uniqueStrings(row.phones || []),
        websites: uniqueStrings(row.websites || []),
        address: normalizeWhitespace(row.address || ''),
        notes: normalizeWhitespace(row.notes || '')
      });
      continue;
    }

    existing.emails = uniqueStrings([...(existing.emails || []), ...(row.emails || [])]);
    existing.phones = uniqueStrings([...(existing.phones || []), ...(row.phones || [])]);
    existing.websites = uniqueStrings([...(existing.websites || []), ...(row.websites || [])]);
    existing.address = existing.address || row.address || '';
    existing.notes = uniqueStrings([existing.notes, row.notes]).join(' | ');
  }

  return [...seen.values()].filter((row) => row.business_name || row.emails.length || row.phones.length);
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DemonLeadForge/1.0; +https://netlify.com)'
    }
  });

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status}`);
  }
  if (!contentType.includes('text/html')) {
    return { html: '', contentType, skipped: true };
  }

  const html = await response.text();
  return { html, contentType, skipped: false };
}

function collectInternalLinks($, pageUrl) {
  const links = $('a[href]')
    .map((_, el) => safeUrl($(el).attr('href'), pageUrl.href))
    .get()
    .filter(Boolean)
    .filter((url) => sameOrigin(url, pageUrl))
    .filter((url) => !/(#|\.pdf$|\.jpg$|\.jpeg$|\.png$|\.gif$|\.webp$|\.svg$|\.zip$|\.mp4$|\.mp3$)/i.test(url.href));

  const unique = new Map();
  for (const url of links) {
    const cleaned = `${url.origin}${url.pathname}${url.search}`;
    if (!unique.has(cleaned)) unique.set(cleaned, url);
  }

  return [...unique.values()].sort((a, b) => scoreLink(b) - scoreLink(a));
}

export async function scrapeSite({ url, maxPages = 12 }) {
  const startUrl = safeUrl(url);
  if (!startUrl) throw new Error('Invalid URL.');
  if (!/^https?:$/.test(startUrl.protocol)) throw new Error('Only http and https URLs are supported.');

  const visited = new Set();
  const queue = [startUrl.href];
  const leads = [];
  const pages = [];
  const errors = [];

  while (queue.length && visited.size < maxPages) {
    const next = queue.shift();
    if (!next || visited.has(next)) continue;
    visited.add(next);

    try {
      const { html, skipped, contentType } = await fetchHtml(next);
      if (skipped) {
        pages.push({ url: next, skipped: true, contentType });
        continue;
      }

      const $ = cheerio.load(html);
      const pageUrl = new URL(next);
      const pageTitle = normalizeWhitespace($('title').text() || pageUrl.pathname || pageUrl.hostname);
      pages.push({ url: next, title: pageTitle, skipped: false });

      const jsonLdLeads = extractJsonLdBusinesses($).map((row) => ({
        ...row,
        page_title: pageTitle,
        source_url: next
      }));
      leads.push(...jsonLdLeads);

      const pageLead = extractPageLead($, pageUrl);
      if (pageLead.emails.length || pageLead.phones.length || jsonLdLeads.length === 0) {
        leads.push(pageLead);
      }

      const internalLinks = collectInternalLinks($, pageUrl);
      for (const link of internalLinks) {
        if (visited.size + queue.length >= maxPages * 3) break;
        if (!visited.has(link.href) && !queue.includes(link.href)) {
          queue.push(link.href);
        }
      }
    } catch (error) {
      errors.push({ url: next, error: error?.message || String(error) });
    }
  }

  const deduped = dedupeRows(leads).slice(0, 1000).map((row, index) => ({
    ...row,
    source_rank: index + 1
  }));

  return {
    url: startUrl.href,
    maxPages,
    visitedCount: visited.size,
    pages,
    errors,
    leads: deduped
  };
}

function csvEscape(value) {
  const stringValue = value == null ? '' : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function leadsToCsv(rows = []) {
  const headers = ['business_name', 'contact_name', 'emails', 'phones', 'websites', 'address', 'page_title', 'source_url', 'notes'];
  const lines = [headers.join(',')];

  for (const row of rows) {
    const values = [
      row.business_name,
      row.contact_name,
      (row.emails || []).join(' | '),
      (row.phones || []).join(' | '),
      (row.websites || []).join(' | '),
      row.address,
      row.page_title,
      row.source_url,
      row.notes
    ].map(csvEscape);
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

export function mergeLeadRows(rows = []) {
  return dedupeRows(rows);
}
