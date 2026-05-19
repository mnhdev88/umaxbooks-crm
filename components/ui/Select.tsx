'use client'

import { cn } from '@/lib/utils'
import { SelectHTMLAttributes, forwardRef, useId } from 'react'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, id, options, placeholder, ...props }, ref) => {
    const generatedId = useId()
    const selectId = id ?? generatedId
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={selectId} className="text-[13px] font-medium text-slate-400">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:border-orange-500',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-red-500',
            className
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <span className="text-xs text-red-400" role="alert">{error}</span>}
      </div>
    )
  }
)

Select.displayName = 'Select'
