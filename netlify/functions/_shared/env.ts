/**
 * Environment variable helpers for Netlify functions.  Use must()
 * when an environment variable is required; it throws an error
 * instead of returning undefined.  Use opt() for optional values
 * with an optional fallback.
 */
export function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function opt(name: string, fallback = ""): string {
  return process.env[name] || fallback;
}