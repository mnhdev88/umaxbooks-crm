'use client'
import { useState, useEffect } from 'react'
import { FileSignature, CheckCircle, AlertCircle } from 'lucide-react'
import {
  CONTRACT_PACKAGES, MIN_MONTHS, MAX_MONTHS,
  FALLBACK_PACKAGE_DEFAULTS, buildInstallmentPlan, usd,
  type PackageDefaults,
} from '@/lib/contract-plan'
import { ScopeItemsEditor } from '@/components/contracts/ScopeItemsEditor'

type Draft = Record<string, { total: string; down_pct: string; months: string; scope: string[] }>

function toDraft(d: PackageDefaults): Draft {
  const out: Draft = {}
  for (const pkg of CONTRACT_PACKAGES) {
    const row = d[pkg] || FALLBACK_PACKAGE_DEFAULTS[pkg]
    out[pkg] = {
      total:    String(row.total),
      down_pct: String(row.down_pct),
      months:   String(row.months),
      scope:    [...(row.scope || FALLBACK_PACKAGE_DEFAULTS[pkg].scope)],
    }
  }
  return out
}

// Suggested numbers the contract modal pre-fills when a rep picks a package.
// They are only a starting point — the rep can always override them per deal.
// Reads/writes app_settings.contract_package_defaults via /api/settings/contract-packages.
export function ContractPackageDefaults() {
  const [draft, setDraft]   = useState<Draft>(() => toDraft(FALLBACK_PACKAGE_DEFAULTS))
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/contract-packages')
      .then(r => r.json())
      .then(d => { if (d?.defaults) setDraft(toDraft(d.defaults)); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [])

  function edit(pkg: string, key: 'total' | 'down_pct' | 'months', value: string) {
    setDraft(d => ({ ...d, [pkg]: { ...d[pkg], [key]: value } }))
    setResult(null)
  }

  function setScope(pkg: string, scope: string[]) {
    setDraft(d => ({ ...d, [pkg]: { ...d[pkg], scope } }))
    setResult(null)
  }

  // Preview each row the same way the contract modal will compute it, so an
  // admin sees the monthly figure their reps are about to quote.
  function preview(pkg: string) {
    const row   = draft[pkg]
    const total = Number(row.total) || 0
    return buildInstallmentPlan({
      total,
      down:      total * (Number(row.down_pct) || 0) / 100,
      months:    Number(row.months),
      // Any valid date works — only the amounts are shown here.
      startDate: '2026-01-01',
    })
  }

  async function save() {
    setSaving(true)
    setResult(null)
    const defaults: PackageDefaults = {}
    for (const pkg of CONTRACT_PACKAGES) {
      defaults[pkg] = {
        total:    Number(draft[pkg].total),
        down_pct: Number(draft[pkg].down_pct),
        months:   Math.trunc(Number(draft[pkg].months)),
        scope:    draft[pkg].scope,
      }
    }
    const res  = await fetch('/api/settings/contract-packages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaults }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      setDraft(toDraft(data.defaults))
      setResult({ ok: true, msg: 'Saved — new contracts will use these suggestions.' })
    } else {
      setResult({ ok: false, msg: data.error || 'Failed to save.' })
    }
  }

  return (
    <div className="bg-[#160E32] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <FileSignature className="w-4 h-4 text-orange-400" />
        <h2 className="text-slate-100 font-semibold text-lg">Contract Package Defaults</h2>
      </div>
      <p className="text-slate-400 text-sm mb-5">
        Suggested pricing, installment terms and scope of services per package. Picking
        a package in the Send Service Agreement form pre-fills these — the rep can still
        change any of them for an individual deal. Contracts already sent keep the scope
        they were sent with.
      </p>

      <div className="space-y-3">
        {CONTRACT_PACKAGES.map(pkg => {
          const plan = preview(pkg)
          return (
            <div key={pkg} className="bg-white/5 border border-white/10 rounded-lg p-4">
              <p className="text-sm text-slate-200 font-medium mb-3">{pkg}</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Total (USD)</label>
                  <input
                    type="number" min={0} step="0.01"
                    value={draft[pkg].total}
                    disabled={!loaded}
                    onChange={e => edit(pkg, 'total', e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Down payment %</label>
                  <input
                    type="number" min={0} max={100} step="1"
                    value={draft[pkg].down_pct}
                    disabled={!loaded}
                    onChange={e => edit(pkg, 'down_pct', e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Monthly payments</label>
                  <input
                    type="number" min={MIN_MONTHS} max={MAX_MONTHS} step="1"
                    value={draft[pkg].months}
                    disabled={!loaded}
                    onChange={e => edit(pkg, 'months', e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
                  />
                </div>
              </div>
              <p className={`text-xs mt-2 ${plan.error ? 'text-amber-400' : 'text-slate-500'}`}>
                {plan.error || `Suggests ${usd(plan.down)} down, then ${usd(plan.monthly)}/month × ${plan.months}.`}
              </p>

              <div className="mt-4 pt-4 border-t border-white/10">
                <label className="text-xs text-slate-400 mb-2 block">
                  Scope of services — shown to the client as section 4 of the agreement
                </label>
                <ScopeItemsEditor
                  items={draft[pkg].scope}
                  onChange={items => setScope(pkg, items)}
                  variant="settings"
                  disabled={!loaded}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-3 flex-wrap mt-4">
        <button
          onClick={save}
          disabled={saving || !loaded}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {result && (
          <span className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border ${result.ok ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'}`}>
            {result.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            {result.msg}
          </span>
        )}
      </div>
    </div>
  )
}
