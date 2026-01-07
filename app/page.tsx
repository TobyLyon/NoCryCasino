"use client"

import { Header } from "@/components/header"
import { AsciiSpaceBackground } from "@/components/ascii-space-background"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

export default function HomePage() {
  // Large detailed ASCII laughing-crying emoji (like reference image)
  const laughingEmoji = `
                      ██████████████████                      
                ██████░░░░░░░░░░░░░░░░██████                
            ████░░░░░░░░░░░░░░░░░░░░░░░░░░████            
          ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██          
        ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██        
      ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██      
    ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██    
    ██░░░░░░████████░░░░░░░░░░░░░░░░████████░░░░░░░░██    
  ██░░░░░░██████████░░░░░░░░░░░░░░██████████░░░░░░░░░░██  
  ██░░░░████████████░░░░░░░░░░░░░░████████████░░░░░░░░██  
  ██░░░░██████████░░░░░░░░░░░░░░░░░░██████████░░░░░░░░██  
  ██░░░░░░████████░░░░░░░░░░░░░░░░░░████████░░░░░░░░░░██  
  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██  
  ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██  
  ██░░██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██░░██  
  ██░░░░██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██░░░░██  
    ██░░░░████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████░░░░██    
    ██░░░░░░░░████████████████████████████░░░░░░░░░░██    
      ██░░░░░░░░░░░░████████████████░░░░░░░░░░░░░░██      
        ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██        
          ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██          
            ████░░░░░░░░░░░░░░░░░░░░░░░░░░████            
                ██████░░░░░░░░░░░░░░░░██████                
                      ██████████████████                      
`

  // Blocky pixel-style "NO CRY CASINO" text
  const titleText = `
██  ██  █████      █████ █████  ██  ██
███ ██ ██   ██    ██     ██  ██  ████ 
██████ ██   ██    ██     █████    ██  
██ ███ ██   ██    ██     ██  ██   ██  
██  ██  █████      █████ ██  ██   ██  

 ████   ████  ████  ██ ██  ██  ████  
██     ██  ██ ██    ██ ███ ██ ██  ██ 
██     ██████ ████  ██ ██████ ██  ██ 
██     ██  ██    ██ ██ ██ ███ ██  ██ 
 ████  ██  ██ ████  ██ ██  ██  ████  
`

  const [tickerItems, setTickerItems] = useState<string[]>(["LOADING DAILY KOL PNL"])
  const [tickerRepeat, setTickerRepeat] = useState(1)
  const tickerRef = useRef<HTMLDivElement | null>(null)
  const tickerRowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true

    const formatSol = (v: number) => {
      const sign = v > 0 ? "+" : v < 0 ? "-" : ""
      const abs = Math.abs(v)
      return `${sign}${abs.toFixed(2)} SOL`
    }

    const load = async () => {
      try {
        const res = await fetch("/api/analytics/leaderboard?timeframe=daily&eligibility=0")
        const json = (await res.json().catch(() => null)) as any
        const rows = Array.isArray(json?.rows) ? (json.rows as any[]) : []

        const items = rows
          .slice(0, 30)
          .map((r) => {
            const name = (typeof r?.display_name === "string" && r.display_name.trim().length > 0 ? r.display_name.trim() : null) ??
              (typeof r?.wallet_address === "string" ? r.wallet_address.slice(0, 6) : "KOL")
            const profit = Number(r?.profit_sol)
            const profitText = Number.isFinite(profit) ? formatSol(profit) : "0.00 SOL"
            return `${name} ${profitText}`
          })
          .filter((s) => typeof s === "string" && s.length > 0)

        if (alive) setTickerItems(items.length > 0 ? items : ["NO DAILY DATA"])
      } catch {
        if (alive) setTickerItems(["NO DAILY DATA"])
      }
    }

    void load()
    const t = setInterval(load, 300_000)

    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const tickerBaseItems = useMemo(() => {
    return tickerItems.length > 0 ? tickerItems : ["NO DAILY DATA"]
  }, [tickerItems])

  const tickerRowItems = useMemo(() => {
    const out: string[] = []
    const reps = Math.max(1, Math.min(50, Math.floor(tickerRepeat)))
    for (let i = 0; i < reps; i += 1) out.push(...tickerBaseItems)
    return out.length > 0 ? out : ["NO DAILY DATA"]
  }, [tickerBaseItems, tickerRepeat])

  useLayoutEffect(() => {
    if (!tickerRef.current || !tickerRowRef.current) return

    const container = tickerRef.current
    const row = tickerRowRef.current

    let raf = 0

    const compute = () => {
      if (!container || !row) return
      const c = container.getBoundingClientRect().width
      const r = row.getBoundingClientRect().width
      if (!Number.isFinite(c) || !Number.isFinite(r) || c <= 0 || r <= 0) return

      const unitWidth = r / Math.max(1, tickerRepeat)
      if (!Number.isFinite(unitWidth) || unitWidth <= 0) return

      const next = Math.max(1, Math.min(50, Math.ceil((c * 2) / unitWidth)))
      if (next !== tickerRepeat) setTickerRepeat(next)
    }

    const schedule = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(compute)
    }

    schedule()

    const ro = new ResizeObserver(schedule)
    ro.observe(container)
    ro.observe(row)

    const fonts: any = (document as any)?.fonts
    if (fonts?.ready && typeof fonts.ready.then === "function") {
      fonts.ready.then(schedule).catch(() => null)
    }

    window.addEventListener("load", schedule)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener("load", schedule)
    }
  }, [tickerBaseItems, tickerRepeat])

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-[#7CFF6B]">
      <AsciiSpaceBackground />
      <div className="relative z-10 flex flex-col min-h-screen">
        <Header />

        {/* Scrolling ticker */}
        <div className="ncc-ticker" ref={tickerRef}>
          <div className="ncc-ticker-track">
            <div className="ncc-ticker-row" ref={tickerRowRef}>
              {tickerRowItems.map((t, i) => (
                <span key={`a-${i}`} className="ncc-ticker-item">
                  ◆ {t} ◆
                </span>
              ))}
            </div>
            <div className="ncc-ticker-row" aria-hidden="true">
              {tickerRowItems.map((t, i) => (
                <span key={`b-${i}`} className="ncc-ticker-item">
                  ◆ {t} ◆
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Main content - centered emoji + title */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
          {/* Large animated ASCII emoji */}
          <pre className="ncc-emoji-ascii" aria-label="Laughing crying emoji">
            {laughingEmoji}
          </pre>

          {/* Blocky ASCII title */}
          <pre className="ncc-title-ascii" aria-label="No Cry Casino">
            {titleText}
          </pre>

          {/* Subtle tagline */}
          <div className="mt-6 text-center font-mono text-xs text-[#7CFF6B]/50 tracking-[0.3em]">
            LIVE KOL TRACKING • P2P MARKETS
          </div>
        </div>
      </div>
    </div>
  )
}
