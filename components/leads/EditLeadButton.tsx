'use client'

import { useState } from 'react'
import { Lead, Profile } from '@/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { LeadForm } from './LeadForm'
import { Edit2 } from 'lucide-react'

interface Props {
  lead: Lead
  agents: Profile[]
  userId: string
  role: string
}

export function EditLeadButton({ lead, agents, userId, role }: Props) {
  const [open, setOpen] = useState(false)
  if (role === 'developer') return null
  return (
    <>
      <div className="pt-0.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen(true)}
          className="w-full justify-start gap-1.5 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10"
        >
          <Edit2 size={12} /> Edit Lead
        </Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit Lead" size="lg">
        <LeadForm lead={lead} agents={agents} userId={userId} userRole={role} onSuccess={() => setOpen(false)} />
      </Modal>
    </>
  )
}
