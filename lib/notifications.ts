export { sendEmail } from '@/lib/email'

export function buildDemoScheduledEmail(leadName: string, companyName: string, developerName: string) {
  return {
    subject: `[Noveliotech CRM] New Demo Scheduled — ${companyName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f97316;">Demo Scheduled</h2>
        <p>Hi ${developerName},</p>
        <p>A new demo has been scheduled for <strong>${companyName}</strong> (Contact: ${leadName}).</p>
        <p>Please log in to Noveliotech CRM to view the lead details and prepare the demo.</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}" style="background:#f97316;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;">
          Open CRM
        </a>
      </div>
    `,
  }
}

export function buildRevisionEmail(leadName: string, companyName: string, developerName: string, notes: string) {
  return {
    subject: `[Noveliotech CRM] Revision Requested — ${companyName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f97316;">Revision Requested</h2>
        <p>Hi ${developerName},</p>
        <p>A revision has been requested for <strong>${companyName}</strong> (Contact: ${leadName}).</p>
        <p><strong>Revision Notes:</strong></p>
        <blockquote style="border-left: 3px solid #f97316; padding-left: 12px; color: #555;">${notes || 'See CRM for details.'}</blockquote>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}" style="background:#f97316;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;">
          Open CRM
        </a>
      </div>
    `,
  }
}

export function buildPaymentReceivedEmail(leadName: string, companyName: string, amount: number) {
  return {
    subject: `[Noveliotech CRM] Payment Received — ${companyName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #22c55e;">Payment Received</h2>
        <p>Payment of <strong>$${amount.toLocaleString()}</strong> received from <strong>${companyName}</strong>.</p>
        <p>Go-live checklist has been triggered. Please complete the remaining steps.</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}" style="background:#f97316;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;">
          Open CRM
        </a>
      </div>
    `,
  }
}
