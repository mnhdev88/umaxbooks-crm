import type { MetadataRoute } from 'next'

// Served at /manifest.webmanifest — whitelisted from the auth redirect in
// proxy.ts because browsers fetch it without session cookies.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Noveliotech CRM',
    short_name: 'Novelio CRM',
    description: 'Digital Agency CRM Platform',
    id: '/',
    start_url: '/',
    display: 'standalone',
    background_color: '#0A0820',
    theme_color: '#0A0820',
    orientation: 'portrait-primary',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
