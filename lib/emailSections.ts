// Lightweight Mustache-style conditional sections for email templates.
// Pure string helpers — no server/client-only imports, so both the server
// send path (lib/email.ts) and the in-browser Compose modal can share them.
//
// Supported per key:
//   {{#key}}…{{/key}}  renders the inner block only when the value is present
//   {{^key}}…{{/key}}  renders the inner block only when the value is absent
// Nesting of the same key is not supported (not needed by our templates).

/**
 * Resolve `{{#key}}` / `{{^key}}` blocks for a single key. `present` decides
 * which branch survives; the plain `{{key}}` token is left untouched for the
 * caller's flat replace pass to fill in.
 */
export function renderSection(text: string, key: string, present: boolean): string {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape, defensive
  const positive = new RegExp(`\\{\\{\\s*#\\s*${k}\\s*\\}\\}([\\s\\S]*?)\\{\\{\\s*/\\s*${k}\\s*\\}\\}`, 'gi')
  const negative = new RegExp(`\\{\\{\\s*\\^\\s*${k}\\s*\\}\\}([\\s\\S]*?)\\{\\{\\s*/\\s*${k}\\s*\\}\\}`, 'gi')
  return text
    .replace(positive, (_m, inner) => (present ? inner : ''))
    .replace(negative, (_m, inner) => (present ? '' : inner))
}
