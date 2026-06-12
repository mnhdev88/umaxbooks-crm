'use client'

import { useState, useEffect } from 'react'
import { BellRing, BellOff, Share, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/**
 * Device-level push notification toggle. Shown on the /notifications page.
 *
 * iOS only allows Web Push for PWAs installed to the home screen, so on
 * iOS Safari (browser tab) we show install instructions instead of the toggle.
 */
export function PushSettings() {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [busy, setBusy] = useState(false)
  const [isIOSBrowser, setIsIOSBrowser] = useState(false)

  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setIsIOSBrowser(isIOS && !isStandalone)
      setSupported(false)
      return
    }

    setSupported(true)
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(async (registration) => {
        const sub = await registration.pushManager.getSubscription()
        setSubscription(sub)
      })
      .catch(() => setSupported(false))
  }, [])

  async function subscribe() {
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        toast.error('Notifications are blocked. Allow them in your browser settings.')
        return
      }
      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      })
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      })
      if (!res.ok) throw new Error('subscribe failed')
      setSubscription(sub)
      toast.success('Push notifications enabled on this device.')
    } catch (err) {
      console.error(err)
      toast.error('Could not enable push notifications.')
    } finally {
      setBusy(false)
    }
  }

  async function unsubscribe() {
    setBusy(true)
    try {
      const endpoint = subscription?.endpoint
      await subscription?.unsubscribe()
      if (endpoint) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        })
      }
      setSubscription(null)
      toast.success('Push notifications disabled on this device.')
    } catch {
      toast.error('Could not disable push notifications.')
    } finally {
      setBusy(false)
    }
  }

  if (supported === null) return null

  if (isIOSBrowser) {
    return (
      <div className="flex items-start gap-3 px-4 py-3 mb-6 rounded-xl bg-slate-800/50 border border-slate-700">
        <Share size={16} className="text-orange-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <p className="text-xs text-slate-400">
          To get push notifications on iPhone/iPad, install the app first: tap the{' '}
          <span className="text-slate-200">Share</span> button in Safari, then{' '}
          <span className="text-slate-200">Add to Home Screen</span>, and open the CRM from there.
        </p>
      </div>
    )
  }

  if (!supported) return null

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 mb-6 rounded-xl bg-slate-800/50 border border-slate-700">
      <div className="flex items-center gap-3 min-w-0">
        {subscription ? (
          <BellRing size={16} className="text-orange-400 flex-shrink-0" aria-hidden="true" />
        ) : (
          <BellOff size={16} className="text-slate-500 flex-shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200">Push notifications</p>
          <p className="text-xs text-slate-400 truncate">
            {subscription
              ? 'Enabled on this device — you’ll be notified even when the CRM is closed.'
              : 'Get notified on this device even when the CRM is closed.'}
          </p>
        </div>
      </div>
      <button
        onClick={subscription ? unsubscribe : subscribe}
        disabled={busy}
        className={
          subscription
            ? 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-50 flex-shrink-0'
            : 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-orange-500 hover:bg-orange-600 text-white transition-colors disabled:opacity-50 flex-shrink-0'
        }
      >
        {busy && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
        {subscription ? 'Disable' : 'Enable'}
      </button>
    </div>
  )
}
