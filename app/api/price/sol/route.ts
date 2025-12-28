import { NextResponse } from "next/server"

export const runtime = "nodejs"

let cache: { value: number; ts: number } | null = null

async function getSolPriceUsd(): Promise<number> {
  const now = Date.now()
  if (cache && now - cache.ts < 60_000) return cache.value

  const timeoutMs = 7_000

  const fetchJson = async (url: string) => {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        next: { revalidate: 60 },
        headers: {
          accept: "application/json",
          "user-agent": "trade-wars/1.0",
        },
        signal: controller.signal,
      })
      return { res, json: (await res.json().catch(() => null)) as any }
    } finally {
      clearTimeout(t)
    }
  }

  try {
    {
      const { res, json } = await fetchJson(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      )
      const v = Number(json?.solana?.usd)
      const price = Number.isFinite(v) && v > 0 ? v : 0
      if (res.ok && price > 0) {
        cache = { value: price, ts: now }
        return price
      }
    }

    {
      const { res, json } = await fetchJson("https://price.jup.ag/v4/price?ids=SOL")
      const v = Number(json?.data?.SOL?.price)
      const price = Number.isFinite(v) && v > 0 ? v : 0
      if (res.ok && price > 0) {
        cache = { value: price, ts: now }
        return price
      }
    }

    return cache?.value ?? 124
  } catch {
    return cache?.value ?? 124
  }
}

export async function GET() {
  const solPriceUsd = await getSolPriceUsd()
  return NextResponse.json({ ok: true, solPriceUsd })
}
