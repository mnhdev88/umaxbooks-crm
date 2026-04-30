import { cn, STATUS_COLORS } from '@/lib/utils'

interface BadgeProps {
  children: React.ReactNode
  className?: string
  variant?: 'status' | 'default' | 'success' | 'warning' | 'error'
}

export function Badge({ children, className, variant = 'default' }: BadgeProps) {
  const variants = {
    default: 'bg-slate-700 text-slate-200',
    success: 'bg-green-700 text-green-100',
    warning: 'bg-yellow-700 text-yellow-100',
    error: 'bg-red-700 text-red-100',
    status: '',
  }

  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      variants[variant],
      className
    )}>
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={STATUS_COLORS[status] || 'bg-slate-600 text-slate-100'}>
      {status}
    </Badge>
  )
}
