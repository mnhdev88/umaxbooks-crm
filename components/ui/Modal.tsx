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
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in fade-in" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'bg-slate-900 border border-slate-700 rounded-xl shadow-2xl',
            'w-[calc(100vw-2rem)] flex flex-col',
            'max-h-[90vh]',
            'animate-in fade-in zoom-in-95',
            sizes[size]
          )}
        >
          <div className="flex items-center justify-between p-5 border-b border-slate-700 flex-shrink-0">
            <Dialog.Title className="text-base font-semibold text-slate-100">
              {title}
            </Dialog.Title>
            <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="p-5 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
