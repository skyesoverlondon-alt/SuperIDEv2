export type PreviewFile = {
  path: string;
  content: string;
};

function fileExt(path: string): string {
  const name = String(path || "");
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export function buildFilePreviewDocument(file: PreviewFile | undefined, origin: string): string | null {
  if (!file) return null;
  const ext = fileExt(file.path);

  if (["html", "htm", "svg"].includes(ext)) return file.content;

  if (ext === "md") {
    const baseHref = `${origin.replace(/\/+$/, "")}/`;
    const escaped = file.content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${baseHref}"><title>Preview</title><style>body{margin:0;padding:16px;background:#0b0914;color:#f7f7ff;font-family:ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;line-height:1.45}</style></head><body>${escaped}</body></html>`;
  }

  return null;
}

export function resolvePreviewUrl(
  livePreviewUrl: string | null,
  fallbackPreviewUrl: string | null,
  hardFallbackUrl = "/SkyeDocs/index.html"
): string | null {
  return livePreviewUrl || fallbackPreviewUrl || hardFallbackUrl;
}

export function getPreviewHealthState(previewDocument: string | null, previewUrl: string | null, previewFrameError: string): "file" | "live" | "failed" | "none" {
  if (previewFrameError) return "failed";
  if (previewDocument) return "file";
  if (previewUrl) return "live";
  return "none";
}
