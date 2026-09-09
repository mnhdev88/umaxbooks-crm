# Client front door (nda123.pages.dev)

One static page. A client types their phone number **or** email address, gets a
6-digit code sent to every contact detail we hold for them (email first — SMS is
attempted too but is unreliable until A2P 10DLC clears), and is handed off to
their own documents on the CRM.

It holds no data and talks to nothing but the CRM's public API. The documents,
the access cookie and every PDF stay on `crm.noveliotech.com`.

## Deploy

Cloudflare Pages, project `nda123`, serving this folder as the site root.

**Dashboard:** Workers & Pages → Create → Pages → *Upload assets* → drag this
folder in. Re-uploading replaces it.

**CLI:**

```bash
npx wrangler pages deploy client-portal --project-name nda123
```

No build step, no framework preset — it is one HTML file.

## The one thing to keep in sync

`index.html` hardcodes the CRM origin near the bottom:

```js
const API = 'https://crm.noveliotech.com';
```

And the CRM must allow this page's origin. `lib/client-portal.ts` ships with
`https://nda123.pages.dev` allowlisted; anything else goes in the
`CLIENT_PORTAL_ORIGINS` env var on the VPS (comma-separated), e.g. when you
later point a real domain at the same Pages project:

```
CLIENT_PORTAL_ORIGINS=https://nda123.pages.dev,https://docs.noveliotech.com
```

Also set `NEXT_PUBLIC_CLIENT_PORTAL_URL` on the CRM so the "Start again" button
on an expired handoff points back here.

## Why the redirect exists

The client's browser ends up on `crm.noveliotech.com/share/<token>` rather than
staying here. That is deliberate: the access cookie has to be first-party on the
domain that reads it, and a cookie set from this origin would be a third-party
cookie — Safari and iOS block those outright, so the client would verify
successfully and then be told they aren't verified.

`/api/public/client/verify-code` therefore returns a single-use key that lives
60 seconds, and the browser navigates to it. See
`app/api/public/share/[token]/handoff/route.ts`.

## Testing locally

Serve the folder on any static server and point `API` at your dev CRM:

```bash
npx wrangler pages dev client-portal
```

`http://localhost:8788` is already in the CRM's allowlist.
