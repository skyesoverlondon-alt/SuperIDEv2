# SkyePDF Forge

Static branded PDF generator for Skyes Over London.

## What it does

Paste a raw text blob, style the brand lane, preview the result as paged sheets, and export a branded PDF in the browser.

## Syntax

- `# Heading` for large section headers
- `## Subheading` for medium section headers
- `- bullet` for bullet lists
- `NOTE:` or `CALLOUT:` for branded callout boxes
- `[PAGEBREAK]` to force a new page
- blank lines split paragraphs into separate blocks

## Files

- `index.html` — main app shell
- `app.css` — UI and page styling
- `app.js` — state, preview pagination, export logic
- `manifest.webmanifest` — install metadata
- `sw.js` — simple offline cache
- `assets/logo-optimized.png` — bundled default logo

## Deploy

Drop the folder onto Netlify or Cloudflare Pages as a static site.

## Notes

The PDF export uses the `html2pdf.js` browser bundle from a public CDN. The app itself is static and keeps document state in localStorage.
