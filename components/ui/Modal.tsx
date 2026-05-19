'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 40 }} />
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <Dialog.Content
            className={cn(
              'bg-slate-900 border border-slate-700 rounded-xl shadow-2xl',
              'w-full flex flex-col max-h-[90vh]',
              sizes[size]
            )}
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-700 flex-shrink-0">
              <Dialog.Title className="text-base font-semibold text-slate-100">
                {title}
              </Dialog.Title>
              <button
                onClick={onClose}
                aria-label="Close"
                className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 min-h-0 p-5 overflow-y-auto">{children}</div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
