/** +19086395666 → "+1 908 639 5666". Anything not US E.164 is returned unchanged. */
export function prettyNumber(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164.trim())
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : e164
}
