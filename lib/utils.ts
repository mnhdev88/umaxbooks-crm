import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function getClientFolder(slug: string): string {
  const date = new Date().toISOString().split('T')[0]
  return `clients/${slug}_${date}`
}

export function getFileName(type: string, slug: string, version: string, ext: string): string {
  return `${type}_${slug}_${version}.${ext}`
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(date: string | null | undefined): string {
  if (!date) return '—'
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function timeAgo(date: string): string {
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(date)
}

export const STATUS_COLORS: Record<string, string> = {
  New: 'bg-slate-600 text-slate-100',
  Contacted: 'bg-blue-600 text-blue-100',
  'Audit Ready': 'bg-purple-600 text-purple-100',
  'Demo Scheduled': 'bg-yellow-600 text-yellow-100',
  'Demo Done': 'bg-orange-600 text-orange-100',
  'Closed Won': 'bg-green-600 text-green-100',
  Revision: 'bg-pink-600 text-pink-100',
  Live: 'bg-teal-600 text-teal-100',
  Completed: 'bg-emerald-600 text-emerald-100',
  Lost: 'bg-red-700 text-red-100',
}
