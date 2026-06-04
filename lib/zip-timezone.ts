// Maps a US ZIP code to an IANA timezone using 3-digit ZIP prefix ranges.
// This is an OFFLINE approximation — a small number of border ZIPs (FL panhandle,
// east TN, west KS/NE/TX, ID/MI panhandles, etc.) may resolve to a neighbouring
// zone and be off by one hour. The UI shows the zone label so an agent can
// sanity-check. Good enough for a "what time is it there before I call" hint.

interface TzRange {
  min: number // inclusive 3-digit prefix (0–999)
  max: number // inclusive
  tz: string  // IANA timezone
}

// Ordered, non-overlapping ranges keyed by the first 3 digits of the ZIP.
const RANGES: TzRange[] = [
  { min: 0,   max: 5,   tz: 'America/New_York' },     // NY (Holtsville etc.)
  { min: 6,   max: 9,   tz: 'America/Puerto_Rico' },  // PR / USVI
  { min: 10,  max: 319, tz: 'America/New_York' },     // New England → GA (Eastern)
  { min: 320, max: 323, tz: 'America/New_York' },     // FL east + Tallahassee
  { min: 324, max: 325, tz: 'America/Chicago' },      // FL panhandle (Panama City, Pensacola)
  { min: 326, max: 349, tz: 'America/New_York' },     // FL east/south
  { min: 350, max: 369, tz: 'America/Chicago' },      // Alabama
  { min: 370, max: 373, tz: 'America/Chicago' },      // TN middle (Nashville)
  { min: 374, max: 374, tz: 'America/New_York' },     // Chattanooga
  { min: 375, max: 376, tz: 'America/Chicago' },      // TN
  { min: 377, max: 379, tz: 'America/New_York' },     // East TN (Knoxville)
  { min: 380, max: 385, tz: 'America/Chicago' },      // West TN (Memphis)
  { min: 386, max: 397, tz: 'America/Chicago' },      // Mississippi
  { min: 398, max: 399, tz: 'America/New_York' },     // Georgia
  { min: 400, max: 419, tz: 'America/New_York' },     // KY central/east
  { min: 420, max: 421, tz: 'America/Chicago' },      // KY west (Paducah)
  { min: 422, max: 427, tz: 'America/New_York' },     // KY
  { min: 430, max: 458, tz: 'America/New_York' },     // Ohio
  { min: 459, max: 462, tz: 'America/New_York' },     // Indiana
  { min: 463, max: 464, tz: 'America/Chicago' },      // NW Indiana (Gary)
  { min: 465, max: 475, tz: 'America/New_York' },     // Indiana
  { min: 476, max: 477, tz: 'America/Chicago' },      // SW Indiana (Evansville)
  { min: 478, max: 498, tz: 'America/New_York' },     // Indiana / Michigan
  { min: 499, max: 499, tz: 'America/Chicago' },      // Western UP Michigan
  { min: 500, max: 528, tz: 'America/Chicago' },      // Iowa
  { min: 530, max: 549, tz: 'America/Chicago' },      // Wisconsin
  { min: 550, max: 567, tz: 'America/Chicago' },      // Minnesota
  { min: 570, max: 575, tz: 'America/Chicago' },      // SD east
  { min: 576, max: 577, tz: 'America/Denver' },       // SD west (Rapid City)
  { min: 580, max: 586, tz: 'America/Chicago' },      // ND east
  { min: 587, max: 588, tz: 'America/Denver' },       // ND west
  { min: 590, max: 599, tz: 'America/Denver' },       // Montana
  { min: 600, max: 629, tz: 'America/Chicago' },      // Illinois
  { min: 630, max: 658, tz: 'America/Chicago' },      // Missouri
  { min: 660, max: 679, tz: 'America/Chicago' },      // Kansas
  { min: 680, max: 689, tz: 'America/Chicago' },      // Nebraska east
  { min: 690, max: 693, tz: 'America/Denver' },       // Nebraska panhandle
  { min: 700, max: 714, tz: 'America/Chicago' },      // Louisiana
  { min: 716, max: 729, tz: 'America/Chicago' },      // Arkansas
  { min: 730, max: 749, tz: 'America/Chicago' },      // Oklahoma
  { min: 750, max: 797, tz: 'America/Chicago' },      // Texas
  { min: 798, max: 799, tz: 'America/Denver' },       // West TX (El Paso)
  { min: 800, max: 816, tz: 'America/Denver' },       // Colorado
  { min: 820, max: 831, tz: 'America/Denver' },       // Wyoming
  { min: 832, max: 837, tz: 'America/Denver' },       // Idaho south
  { min: 838, max: 838, tz: 'America/Los_Angeles' },  // Idaho panhandle (Coeur d'Alene)
  { min: 840, max: 847, tz: 'America/Denver' },       // Utah
  { min: 850, max: 864, tz: 'America/Phoenix' },      // Arizona (no DST)
  { min: 870, max: 884, tz: 'America/Denver' },       // New Mexico
  { min: 889, max: 898, tz: 'America/Los_Angeles' },  // Nevada
  { min: 900, max: 961, tz: 'America/Los_Angeles' },  // California
  { min: 967, max: 968, tz: 'Pacific/Honolulu' },     // Hawaii
  { min: 969, max: 969, tz: 'Pacific/Guam' },         // Guam / Micronesia
  { min: 970, max: 979, tz: 'America/Los_Angeles' },  // Oregon
  { min: 980, max: 994, tz: 'America/Los_Angeles' },  // Washington
  { min: 995, max: 999, tz: 'America/Anchorage' },    // Alaska
]

/**
 * Resolve a US ZIP code to an IANA timezone string, or null if it can't be
 * confidently mapped (non-US / malformed ZIP).
 */
export function getTimezoneFromZip(zip?: string | null): string | null {
  if (!zip) return null
  const digits = String(zip).trim().match(/^\d{3,5}/)?.[0]
  if (!digits || digits.length < 3) return null
  const prefix = parseInt(digits.slice(0, 3), 10)
  if (Number.isNaN(prefix)) return null
  for (const r of RANGES) {
    if (prefix >= r.min && prefix <= r.max) return r.tz
  }
  return null
}
