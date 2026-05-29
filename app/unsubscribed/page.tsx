import { MailX, CheckCircle } from 'lucide-react'

interface Props {
  searchParams: Promise<{ error?: string }>
}

export default async function UnsubscribedPage({ searchParams }: Props) {
  const { error } = await searchParams
  const isError = error === '1'

  return (
    <div className="min-h-screen bg-[#0A0820] flex items-center justify-center p-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 max-w-md w-full text-center space-y-5">
        {isError ? (
          <>
            <div className="flex justify-center">
              <MailX size={48} className="text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-slate-100">Invalid Link</h1>
            <p className="text-slate-400 text-sm">
              This unsubscribe link is no longer valid or has already been used.
            </p>
          </>
        ) : (
          <>
            <div className="flex justify-center">
              <CheckCircle size={48} className="text-green-400" />
            </div>
            <h1 className="text-xl font-bold text-slate-100">You've been unsubscribed</h1>
            <p className="text-slate-400 text-sm">
              You will no longer receive marketing emails from our team. If this was a mistake, please contact us directly.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
