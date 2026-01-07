"use client"

import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Search } from "lucide-react"
import { WalletButton } from "@/components/wallet-button"
import { Button } from "@/components/ui/button"

import solLogo from "@/kolscan-clone/public/images/solana-sol-logo.png"

export function Header() {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [solPriceUsd, setSolPriceUsd] = useState<number | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        const res = await fetch("/api/price/sol")
        const json = (await res.json().catch(() => null)) as any
        if (!mounted) return
        if (res.ok && json?.ok && typeof json?.solPriceUsd === "number") {
          setSolPriceUsd(json.solPriceUsd)
          return
        }
        setSolPriceUsd(null)
      } catch {
        if (!mounted) return
        setSolPriceUsd(null)
      }
    }

    load()
    const t = setInterval(load, 60_000)

    return () => {
      mounted = false
      clearInterval(t)
    }
  }, [])

  const go = () => {
    const v = query.trim()
    if (!v) return
    router.push(`/kol/${encodeURIComponent(v)}`)
    setQuery("")
  }

  return (
    <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="container mx-auto px-4 h-14 flex items-center gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="ncc-nav-logo" title="No Cry Casino">
            <span className="ncc-nav-diamond" aria-hidden>
              ◆
            </span>
            <span className="sr-only">No Cry Casino</span>
          </Link>
          <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-1.5 text-xs">
            <Image src={solLogo} alt="Solana" className="h-4 w-4" />
            <div className="text-muted-foreground tabular-nums">
              {solPriceUsd !== null ? `$${solPriceUsd.toFixed(2)}` : "$--.--"}
            </div>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-5 text-sm">
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            Home
          </Link>
          <Link href="/markets" className="text-muted-foreground hover:text-foreground transition-colors">
            Markets
          </Link>
          <Link href="/pm" className="text-muted-foreground hover:text-foreground transition-colors">
            Prediction Markets
          </Link>
          <Link href="/leaderboard" className="text-muted-foreground hover:text-foreground transition-colors">
            Leaderboard
          </Link>
        </nav>

        <div className="flex-1" />

        <div className="hidden lg:flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") go()
              }}
              placeholder="Search wallet"
              className="h-9 w-[260px] rounded-md border border-border bg-background/40 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <Button asChild className="h-9 px-3">
            <a href="https://join.pump.fun/HSag/kolscan/" target="_blank" rel="noreferrer">
              Pump app
            </a>
          </Button>
        </div>

        <WalletButton />
      </div>
    </header>
  )
}
