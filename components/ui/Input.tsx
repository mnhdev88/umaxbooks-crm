'use client'

import { cn } from '@/lib/utils'
import { InputHTMLAttributes, forwardRef, useId } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-[13px] font-medium text-slate-400">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:border-orange-500',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-red-500 focus-visible:ring-red-500/50',
            className
          )}
          {...props}
        />
        {error && <span className="text-xs text-red-400" role="alert">{error}</span>}
      </div>
    )
  }
)

Input.displayName = 'Input'

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const generatedId = useId()
    const textareaId = id ?? generatedId
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={textareaId} className="text-[13px] font-medium text-slate-400">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            'w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 resize-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:border-orange-500',
            error && 'border-red-500',
            className
          )}
          rows={3}
          {...props}
        />
        {error && <span className="text-xs text-red-400" role="alert">{error}</span>}
      </div>
    )
  }
)

TextArea.displayName = 'TextArea'
