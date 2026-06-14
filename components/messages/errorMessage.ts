// Supabase / PostgREST errors are sometimes Error instances (network failures)
// whose fields are non-enumerable, so `console.error(err)` prints `{}` and
// `err.message` reads blank. This pulls out whatever detail actually exists.
export function describeSupabaseError(e: unknown): string {
  if (!e) return 'unknown error'
  if (typeof e === 'string') return e
  const err = e as Record<string, unknown>
  const parts = [err.message, err.details, err.hint, err.code]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (parts.length) return parts.join(' — ')
  try {
    // Captures non-enumerable props (e.g. on Error instances).
    return JSON.stringify(e, Object.getOwnPropertyNames(e as object))
  } catch {
    return String(e)
  }
}
