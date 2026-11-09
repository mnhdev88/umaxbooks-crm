import MailComposer from 'nodemailer/lib/mail-composer'
import { getMailboxToken } from './workspace'

/** Thin Gmail REST client acting as one Workspace mailbox. */

export class GmailApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

const API = 'https://gmail.googleapis.com'

async function gmailRequest<T>(mailbox: string, url: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const token = await getMailboxToken(mailbox)
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    })
    if (res.ok) return (await res.json()) as T
    // Rate limits / transient errors: brief backoff, max 3 retries
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt))
      continue
    }
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new GmailApiError(body?.error?.message || `Gmail API error ${res.status}`, res.status)
  }
}

const userPath = (p: string) => `${API}/gmail/v1/users/me/${p}`

// ---- Types (only the fields we use) -----------------------------------------

export interface GmailHeader { name: string; value: string }
export interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: GmailPart[]
}
export interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  internalDate?: string
  payload?: GmailPart
}

// ---- Calls ------------------------------------------------------------------

export function getProfile(mailbox: string) {
  return gmailRequest<{ emailAddress: string; historyId: string }>(mailbox, userPath('profile'))
}

export function getMessage(
  mailbox: string,
  id: string,
  format: 'metadata' | 'full',
  metadataHeaders: string[] = [],
) {
  const qs = new URLSearchParams({ format })
  for (const h of metadataHeaders) qs.append('metadataHeaders', h)
  return gmailRequest<GmailMessage>(mailbox, userPath(`messages/${id}?${qs}`))
}

export function listMessages(mailbox: string, q: string, pageToken?: string | null, maxResults = 100) {
  const qs = new URLSearchParams({ q, maxResults: String(maxResults) })
  if (pageToken) qs.set('pageToken', pageToken)
  return gmailRequest<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(
    mailbox, userPath(`messages?${qs}`),
  )
}

export function listHistory(mailbox: string, startHistoryId: string, pageToken?: string | null) {
  const qs = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', maxResults: '500' })
  if (pageToken) qs.set('pageToken', pageToken)
  return gmailRequest<{
    history?: { messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[]
    nextPageToken?: string
    historyId: string
  }>(mailbox, userPath(`history?${qs}`))
}

/**
 * Sends a raw RFC 822 message from the mailbox. Uses the multipart upload endpoint
 * so attachments up to Gmail's 35 MB limit work and a threadId can be attached.
 */
export async function sendRawMessage(mailbox: string, raw: Buffer, threadId?: string | null) {
  const boundary = `crm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  const meta = JSON.stringify(threadId ? { threadId } : {})
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`),
    raw,
    Buffer.from(`\r\n--${boundary}--`),
  ])
  return gmailRequest<{ id: string; threadId: string; labelIds?: string[] }>(
    mailbox,
    `${API}/upload/gmail/v1/users/me/messages/send?uploadType=multipart`,
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
  )
}

// ---- MIME building ----------------------------------------------------------

export interface ComposeOptions {
  from: string
  to: string
  cc?: string[]
  bcc?: string[]
  subject: string
  html: string
  attachments?: { filename: string; content: Buffer; contentType?: string }[]
  inReplyTo?: string | null
  references?: string | null
}

export function buildRawMessage(opts: ComposeOptions): Promise<Buffer> {
  const mail = new MailComposer({
    from: opts.from,
    to: opts.to,
    cc: opts.cc?.length ? opts.cc : undefined,
    bcc: opts.bcc?.length ? opts.bcc : undefined,
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments,
    inReplyTo: opts.inReplyTo || undefined,
    references: opts.references || undefined,
  }).compile()
  // Gmail reads Bcc recipients from the header (and strips it before delivery)
  ;(mail as unknown as { keepBcc: boolean }).keepBcc = true
  return new Promise((resolve, reject) => {
    mail.build((err: Error | null, message: Buffer) => (err ? reject(err) : resolve(message)))
  })
}

// ---- Parsing helpers --------------------------------------------------------

export function header(msg: GmailMessage, name: string): string {
  const lower = name.toLowerCase()
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === lower)?.value || ''
}

const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

/** All addresses in an address-list header, lower-cased and de-duplicated. */
export function parseAddresses(value: string): string[] {
  return [...new Set((value.match(EMAIL_RE) || []).map(e => e.toLowerCase()))]
}

function decode(data?: string) {
  return data ? Buffer.from(data, 'base64url').toString('utf8') : ''
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Best displayable body (HTML preferred, plain text wrapped) + attachment names. */
export function extractBody(msg: GmailMessage): { html: string; attachments: string[] } {
  let html = ''
  let text = ''
  const attachments: string[] = []

  const walk = (part?: GmailPart) => {
    if (!part) return
    const disposition = part.headers?.find(h => h.name.toLowerCase() === 'content-disposition')?.value || ''
    if (part.filename && (part.body?.attachmentId || /attachment/i.test(disposition))) {
      attachments.push(part.filename)
      return
    }
    if (part.mimeType === 'text/html' && !html) html = decode(part.body?.data)
    else if (part.mimeType === 'text/plain' && !text) text = decode(part.body?.data)
    part.parts?.forEach(walk)
  }
  walk(msg.payload)

  if (!html && text) {
    html = `<div style="white-space:pre-wrap;font-family:sans-serif;font-size:14px">${escapeHtml(text)}</div>`
  }
  return { html, attachments }
}

/** "Re: Fwd: Hello" → "hello" — Gmail only threads replies with a matching subject. */
export function normalizeSubject(subject: string): string {
  let s = (subject || '').trim()
  let prev
  do {
    prev = s
    s = s.replace(/^(re|fw|fwd)\s*(\[\d+\])?\s*:\s*/i, '')
  } while (s !== prev)
  return s.toLowerCase()
}
