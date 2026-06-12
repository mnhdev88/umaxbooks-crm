'use client'

import { useEffect } from 'react'

// Keeps the service worker registered/updated on every app load so push
// keeps working for devices that subscribed long ago. Renders nothing.
export function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch(() => {})
    }
  }, [])
  return null
}
