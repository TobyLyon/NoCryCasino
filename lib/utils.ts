import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizeKolDisplayName(input: unknown): string | null {
  if (typeof input !== 'string') return null

  let s = input.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').replace(/\s+/g, ' ').trim()
  if (!s) return null

  try {
    s = s.normalize('NFC')
  } catch {}

  const looksMojibake = /(?:Ã.|Â|â€|â€™|â€“|â€”|â€œ|â”|ðŸ)/.test(s)
  if (looksMojibake) {
    try {
      const cp1252Map: Record<string, number> = {
        '€': 0x80,
        '‚': 0x82,
        'ƒ': 0x83,
        '„': 0x84,
        '…': 0x85,
        '†': 0x86,
        '‡': 0x87,
        'ˆ': 0x88,
        '‰': 0x89,
        'Š': 0x8a,
        '‹': 0x8b,
        'Œ': 0x8c,
        'Ž': 0x8e,
        '‘': 0x91,
        '’': 0x92,
        '“': 0x93,
        '”': 0x94,
        '•': 0x95,
        '–': 0x96,
        '—': 0x97,
        '˜': 0x98,
        '™': 0x99,
        'š': 0x9a,
        '›': 0x9b,
        'œ': 0x9c,
        'ž': 0x9e,
        'Ÿ': 0x9f,
      }

      const bytes: number[] = []
      let ok = true
      for (const ch of s) {
        const code = ch.codePointAt(0) ?? 0
        if (code <= 0xff) {
          bytes.push(code)
          continue
        }
        const mapped = cp1252Map[ch]
        if (typeof mapped === 'number') {
          bytes.push(mapped)
          continue
        }
        ok = false
        break
      }

      if (!ok) throw new Error('cannot-map-cp1252')

      const repaired = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
      const cleaned = repaired.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').replace(/\s+/g, ' ').trim()
      if (cleaned && cleaned !== s && !cleaned.includes('�')) {
        s = cleaned
      }
    } catch {}
  }

  s = s.replace(/\uFFFD/g, '').trim()
  return s.length > 0 ? s : null
}
