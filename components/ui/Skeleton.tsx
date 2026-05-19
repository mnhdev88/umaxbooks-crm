import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-slate-800/70', className)}
    />
  )
}

export function SkeletonCard() {
  return (
    <div aria-hidden="true" className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div aria-hidden="true" className="space-y-0 rounded-xl overflow-hidden border border-slate-800">
      {/* Header */}
      <div className="flex gap-4 px-4 py-3 bg-slate-800/60 border-b border-slate-800">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3.5 border-b border-slate-800 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-3.5 flex-1', c === 0 && 'max-w-[120px]')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden="true" className={`grid grid-cols-2 md:grid-cols-${count} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}
