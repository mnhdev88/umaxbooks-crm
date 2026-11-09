import { createSign } from 'crypto'

/**
 * Google Workspace access via a service account with domain-wide delegation.
 *
 * The service account impersonates each agent's mailbox (JWT `sub` claim), so
 * agents never sign in to Google individually. Setup: docs/GMAIL_WORKSPACE_SETUP.md
 *
 * Env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  service-account key file contents (raw JSON or base64)
 *   GOOGLE_WORKSPACE_DOMAINS     comma-separated mailbox domains, e.g. "noveliotech.com"
 */

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
]

interface ServiceAccount {
  client_email: string
  private_key: string
}

let cachedSa: ServiceAccount | null | undefined

export function getServiceAccount(): ServiceAccount | null {
  if (cachedSa !== undefined) return cachedSa
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  if (!raw) return (cachedSa = null)
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  const parsed = JSON.parse(text)
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key')
  }
  cachedSa = {
    client_email: parsed.client_email,
    // Keys pasted into env UIs often carry literal "\n"
    private_key: String(parsed.private_key).replace(/\\n/g, '\n'),
  }
  return cachedSa
}

export function workspaceDomains(): string[] {
  return (process.env.GOOGLE_WORKSPACE_DOMAINS || '')
    .split(',')
    .map(d => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
}

export function isWorkspaceEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const domain = email.toLowerCase().split('@')[1]
  return !!domain && workspaceDomains().includes(domain)
}

/** Returns null when ready, otherwise a human-readable reason. */
export function workspaceConfigError(): string | null {
  try {
    if (!getServiceAccount()) return 'GOOGLE_SERVICE_ACCOUNT_JSON is not set'
  } catch (e) {
    return `GOOGLE_SERVICE_ACCOUNT_JSON is invalid: ${e instanceof Error ? e.message : e}`
  }
  if (!workspaceDomains().length) return 'GOOGLE_WORKSPACE_DOMAINS is not set'
  return null
}

// ---- Access tokens (one per impersonated mailbox, cached until near expiry) ----

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

function b64url(input: string | Buffer) {
  return Buffer.from(input).toString('base64url')
}

export async function getMailboxToken(mailbox: string): Promise<string> {
  const key = mailbox.toLowerCase()
  const hit = tokenCache.get(key)
  if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token

  const sa = getServiceAccount()
  if (!sa) throw new Error('Google Workspace is not configured (GOOGLE_SERVICE_ACCOUNT_JSON missing)')

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    sub: key,
    scope: GMAIL_SCOPES.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = signer.sign(sa.private_key).toString('base64url')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string; expires_in?: number; error?: string; error_description?: string
  }
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`
    if (data.error === 'unauthorized_client') {
      throw new Error(
        `Google refused access to ${key}: domain-wide delegation is not set up for this service account ` +
        `or the Gmail scopes are missing in the Workspace Admin console (${detail})`
      )
    }
    if (data.error === 'invalid_grant') {
      throw new Error(`Google refused access to ${key}: mailbox not found in the Workspace domain or suspended (${detail})`)
    }
    throw new Error(`Google token error for ${key}: ${detail}`)
  }
  tokenCache.set(key, { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 })
  return data.access_token
}
