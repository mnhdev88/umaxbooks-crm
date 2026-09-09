import { Shell, Notice } from '../[token]/Shell'

/**
 * Where a failed handoff lands.
 *
 * The one-time key from the front door lives 60 seconds and is single-use, so
 * a client who left the tab open, hit back, or reloaded an old URL arrives
 * here. It is a dead end by design — the fix is always "go back and enter your
 * number again", never a retry of the same link.
 *
 * A static segment under /share, so it takes precedence over /share/[token];
 * tokens are uuids and can never collide with it.
 */
export const dynamic = 'force-dynamic'

const FRONT_DOOR = process.env.NEXT_PUBLIC_CLIENT_PORTAL_URL || 'https://nda123.pages.dev'

const REASONS: Record<string, string> = {
  missing:     'That link is incomplete.',
  expired:     'That link has already been used, or it timed out.',
  unavailable: 'Those documents are no longer being shared.',
}

interface PageProps {
  searchParams: Promise<{ reason?: string }>
}

export default async function ShareExpiredPage({ searchParams }: PageProps) {
  const { reason } = await searchParams
  const detail = REASONS[reason ?? ''] || REASONS.expired

  return (
    <Shell>
      <Notice
        icon="⏳"
        title="Please sign in again"
        body={`${detail} Enter your phone number again and we'll send you a fresh code — it only takes a moment.`}
      />
      <p style={{ textAlign: 'center', marginTop: '18px' }}>
        <a
          href={FRONT_DOOR}
          style={{
            display: 'inline-block',
            padding: '13px 26px',
            background: '#1F3A93',
            color: '#fff',
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: '15px',
            fontWeight: 700,
            textDecoration: 'none',
            borderRadius: '10px',
          }}
        >
          Start again →
        </a>
      </p>
    </Shell>
  )
}
