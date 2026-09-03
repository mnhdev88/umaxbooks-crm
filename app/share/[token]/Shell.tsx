/**
 * Chrome shared by every state of the client share page.
 *
 * Inline styles, like /sign/<token>: this page renders inside the app's dark
 * root layout but is shown to CLIENTS, not staff, so it paints its own light
 * surface and takes nothing from globals.css — which also keeps it out of the
 * per-class light-mode override list the dashboard has to maintain.
 */
export function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#f1f3fa',
      fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
      padding: '32px 14px 56px',
      color: '#111827',
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: wide ? '760px' : '420px', margin: '0 auto' }}>
        {children}
      </div>
    </div>
  )
}

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: '16px',
      boxShadow: '0 8px 40px rgba(31,58,147,.13)',
      overflow: 'hidden',
      ...style,
    }}>
      <div style={{ height: '5px', background: 'linear-gradient(90deg,#1F3A93,#4a6cf7,#b8902a)' }} />
      {children}
    </div>
  )
}

export function Notice({ icon, title, body, email }: {
  icon: string
  title: string
  body: string
  email?: string
}) {
  return (
    <Card>
      <div style={{ padding: '40px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: '46px', marginBottom: '14px' }}>{icon}</div>
        <h1 style={{ color: '#1F3A93', fontSize: '20px', fontWeight: 700, margin: '0 0 10px' }}>{title}</h1>
        <p style={{ color: '#6b7280', fontSize: '14px', lineHeight: 1.6, margin: 0 }}>
          {body}
          {email && (
            <>
              {' '}
              <a href={`mailto:${email}`} style={{ color: '#1F3A93', fontWeight: 600 }}>{email}</a>
            </>
          )}
        </p>
      </div>
    </Card>
  )
}
