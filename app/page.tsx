"use client"

import { Header } from "@/components/header"
import { useEffect, useMemo, useState } from "react"

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

  const tickerText = useMemo(() => {
    const items = tickerItems.length > 0 ? tickerItems : ["NO DAILY DATA"]
    const doubled = [...items, ...items]
    return doubled
  }, [tickerItems])

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-[#7CFF6B]">
      <div className="relative z-10 flex flex-col min-h-screen">
        <Header />

        {/* Scrolling ticker */}
        <div className="ncc-ticker">
          <div className="ncc-ticker-track">
            {tickerText.map((t, i) => (
              <span key={i} className="ncc-ticker-item">
                ◆ {t} ◆
              </span>
            ))}
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
