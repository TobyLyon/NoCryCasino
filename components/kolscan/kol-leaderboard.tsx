"use client"

import type React from "react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { Search, Copy, Check } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type TimeFrame = "daily" | "weekly" | "monthly"

type KOL = {
  rank: number
  name: string
  avatar: string | null
  wallet: string
  fullWallet: string
  wins: number
  losses: number
  profit: number
  profitUsd: number
  hasTelegram: boolean
  hasTwitter: boolean
  twitterUrl: string | null
}

function shortenWallet(wallet: string) {
  return wallet.slice(0, 6)
}

function formatSol(n: number) {
  return Number.isFinite(n) ? n.toFixed(2) : "0.00"
}

function Avatar({ src, alt, size, className }: { src: string | null; alt: string; size: number; className?: string }) {
  const [failed, setFailed] = useState(false)

  const initial = typeof alt === "string" && alt.trim().length > 0 ? alt.trim()[0]!.toUpperCase() : "?"

  if (!src || failed) {
    return (
      <div
        className={`${className ?? ""} flex items-center justify-center font-semibold text-[#d5d6d0]`}
        style={{ height: size, width: size }}
      >
        {initial}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}

export function KolLeaderboard() {
  const [timeFrame, setTimeFrame] = useState<TimeFrame>("daily")
  const [searchQuery, setSearchQuery] = useState("")
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null)
  const [selectedKOL, setSelectedKOL] = useState<KOL | null>(null)

  const [kols, setKols] = useState<KOL[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function run() {
      setLoading(true)
      setError(null)

      const res = await fetch(`/api/analytics/leaderboard?timeframe=${encodeURIComponent(timeFrame)}`)
      const json = (await res.json()) as any

      if (!res.ok || !json?.ok) {
        if (!isMounted) return
        setError(json?.error ?? "Failed to load leaderboard")
        setKols([])
        setLoading(false)
        return
      }

      const rows = Array.isArray(json?.rows) ? json.rows : []
      const mapped: KOL[] = rows.map((r: any) => {
        const fullWallet = String(r?.wallet_address ?? "")
        const name =
          typeof r?.display_name === "string" && r.display_name.length > 0
            ? r.display_name
            : fullWallet
              ? `${fullWallet.slice(0, 4)}…${fullWallet.slice(-4)}`
              : "Unknown"

        const profit = typeof r?.profit_sol === "number" ? r.profit_sol : Number(r?.profit_sol ?? 0)
        const profitUsd = typeof r?.profit_usd === "number" ? r.profit_usd : Number(r?.profit_usd ?? 0)

        const twitterUrl = typeof r?.twitter_url === "string" && r.twitter_url.length > 0 ? r.twitter_url : null

        return {
          rank: Number(r?.rank ?? 0) || 0,
          name,
          avatar: typeof r?.avatar_url === "string" ? r.avatar_url : null,
          wallet: fullWallet ? shortenWallet(fullWallet) : "",
          fullWallet,
          wins: Number(r?.wins ?? 0) || 0,
          losses: Number(r?.losses ?? 0) || 0,
          profit: Number.isFinite(profit) ? profit : 0,
          profitUsd: Number.isFinite(profitUsd) ? profitUsd : 0,
          hasTelegram: typeof r?.telegram_url === "string" && r.telegram_url.length > 0,
          hasTwitter:
            (typeof r?.twitter_handle === "string" && r.twitter_handle.length > 0) ||
            (typeof r?.twitter_url === "string" && r.twitter_url.length > 0),
          twitterUrl,
        }
      })

      if (!isMounted) return
      setKols(mapped)
      setLoading(false)
    }

    run().catch((e: any) => {
      if (!isMounted) return
      setError(e?.message ?? String(e))
      setKols([])
      setLoading(false)
    })

    return () => {
      isMounted = false
    }
  }, [timeFrame])

  const filteredKOLs = useMemo(() => {
    if (!searchQuery) return kols
    const query = searchQuery.toLowerCase()
    return kols.filter(
      (kol) =>
        kol.name.toLowerCase().includes(query) ||
        kol.wallet.toLowerCase().includes(query) ||
        kol.fullWallet.toLowerCase().includes(query),
    )
  }, [kols, searchQuery])

  const copyToClipboard = async (wallet: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(wallet)
    setCopiedWallet(wallet)
    setTimeout(() => setCopiedWallet(null), 2000)
  }

  return (
    <div className="bg-[#191a1a] text-[#d5d6d0]">
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
          <div>
            <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <h2 className="text-2xl font-bold">KOL Leaderboard</h2>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9a9b95]" />
                  <input
                    type="text"
                    placeholder="Search by name or wallet address..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-10 w-full sm:w-[320px] rounded-lg border border-[#2a2b2b] bg-[#191a1a] pl-9 pr-3 text-sm text-white placeholder:text-[#9a9b95] outline-none"
                  />
                </div>

                <div className="flex gap-2 rounded-lg border border-[#2a2b2b] p-1">
                  <button
                    type="button"
                    onClick={() => setTimeFrame("daily")}
                    className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
                      timeFrame === "daily" ? "bg-[#2a2b2b] text-white" : "text-[#d5d6d0] hover:text-white"
                    }`}
                  >
                    Daily
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimeFrame("weekly")}
                    className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
                      timeFrame === "weekly" ? "bg-[#2a2b2b] text-white" : "text-[#d5d6d0] hover:text-white"
                    }`}
                  >
                    Weekly
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimeFrame("monthly")}
                    className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
                      timeFrame === "monthly" ? "bg-[#2a2b2b] text-white" : "text-[#d5d6d0] hover:text-white"
                    }`}
                  >
                    Monthly
                  </button>
                </div>
              </div>
            </div>

            {searchQuery && (
              <div className="mb-4 text-sm text-[#9a9b95]">
                Found {filteredKOLs.length} result{filteredKOLs.length !== 1 ? "s" : ""}
              </div>
            )}

            <div className="space-y-3">
              {loading ? (
                <div className="rounded-xl border border-[#2a2b2b] bg-[#1f2020] p-8 text-center">
                  <p className="text-[#9a9b95]">Loading…</p>
                </div>
              ) : error ? (
                <div className="rounded-xl border border-[#2a2b2b] bg-[#1f2020] p-8 text-center">
                  <p className="text-[#9a9b95]">Failed to load KOLs: {error}</p>
                </div>
              ) : kols.length === 0 && !searchQuery ? (
                <div className="rounded-xl border border-[#2a2b2b] bg-[#1f2020] p-8 text-center">
                  <p className="text-[#9a9b95]">No KOLs yet.</p>
                  <p className="mt-2 text-sm text-[#9a9b95]">
                    Seed tracked wallets with
                    {" "}
                    <span className="font-mono">POST /api/admin/kols/seed</span>
                    {" "}
                    (requires your
                    {" "}
                    <span className="font-mono">ADMIN_API_KEY</span>
                    {" "}Bearer token).
                  </p>
                </div>
              ) : filteredKOLs.length > 0 ? (
                filteredKOLs.map((kol) => (
                  <div
                    key={kol.fullWallet}
                    onClick={() => setSelectedKOL(kol)}
                    className={`flex items-center gap-4 rounded-xl border border-[#2a2b2b] p-4 transition-all hover:border-[#3a3b3b] cursor-pointer ${
                      kol.rank === 1 ? "gold-gradient" : "bg-[#1f2020]"
                    }`}
                  >
                    <div className="flex w-8 items-center justify-center">
                      {kol.rank === 1 ? (
                        <img
                          src="https://ext.same-assets.com/3959085109/2109555233.webp"
                          alt="trophy"
                          className="h-6 w-6"
                        />
                      ) : (
                        <span className="text-lg font-semibold">{kol.rank}</span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <Avatar
                        src={kol.avatar}
                        alt={kol.name}
                        size={40}
                        className="h-10 w-10 rounded-full border-2 border-[#3a3b3b] bg-[#2a2b2b]"
                      />

                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{kol.name}</span>
                        {kol.hasTwitter && (
                          <a
                            href={kol.twitterUrl ?? `https://x.com/search?q=${encodeURIComponent(kol.name)}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex"
                            title="Open Twitter"
                          >
                            <img
                              src="https://ext.same-assets.com/3959085109/2214575193.webp"
                              alt="twitter"
                              className="h-4 w-4 opacity-70 hover:opacity-100 transition-opacity"
                            />
                          </a>
                        )}
                        {kol.hasTelegram && (
                          <img
                            src="https://ext.same-assets.com/3959085109/1422258496.webp"
                            alt="telegram"
                            className="h-4 w-4 opacity-70"
                          />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[#9a9b95]">{kol.wallet}</span>
                      <button
                        type="button"
                        onClick={(e) => copyToClipboard(kol.fullWallet, e)}
                        className="text-[#9a9b95] hover:text-white transition-colors"
                        title="Copy full wallet address"
                      >
                        {copiedWallet === kol.fullWallet ? (
                          <Check className="h-4 w-4 text-[#2eae5b]" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    <div className="flex-1" />

                    <div className="text-sm">
                      <span className="text-[#2eae5b]">{kol.wins}</span>
                      <span className="text-[#9a9b95]">/</span>
                      <span className="text-[#d87373]">{kol.losses}</span>
                    </div>

                    <div className="text-right">
                      <div className="font-semibold profit-green">+{formatSol(kol.profit)} Sol</div>
                      <div className="text-sm profit-green">(${kol.profitUsd.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })})</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-[#2a2b2b] bg-[#1f2020] p-8 text-center">
                  <p className="text-[#9a9b95]">No KOLs found matching "{searchQuery}"</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <Dialog open={!!selectedKOL} onOpenChange={() => setSelectedKOL(null)}>
        <DialogContent className="bg-[#1f2020] border-[#2a2b2b] text-[#d5d6d0] max-w-2xl">
          {selectedKOL && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-4">
                  <Avatar
                    src={selectedKOL.avatar}
                    alt={selectedKOL.name}
                    size={64}
                    className="h-16 w-16 rounded-full border-2 border-[#3a3b3b] bg-[#2a2b2b]"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">{selectedKOL.name}</span>
                      {selectedKOL.rank === 1 && (
                        <img
                          src="https://ext.same-assets.com/3959085109/2109555233.webp"
                          alt="trophy"
                          className="h-6 w-6"
                        />
                      )}
                    </div>
                    <div className="text-sm text-[#9a9b95] font-normal">
                      Rank #{selectedKOL.rank} - {timeFrame.charAt(0).toUpperCase() + timeFrame.slice(1)}
                    </div>
                  </div>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-[#2a2b2b] bg-[#191a1a] p-4">
                    <div className="text-sm text-[#9a9b95] mb-1">Total Profit</div>
                    <div className="text-2xl font-bold profit-green">+{formatSol(selectedKOL.profit)} SOL</div>
                    <div className="text-sm profit-green">
                      ${selectedKOL.profitUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#2a2b2b] bg-[#191a1a] p-4">
                    <div className="text-sm text-[#9a9b95] mb-1">Win Rate</div>
                    <div className="text-2xl font-bold">
                      {selectedKOL.wins + selectedKOL.losses > 0
                        ? ((selectedKOL.wins / (selectedKOL.wins + selectedKOL.losses)) * 100).toFixed(1)
                        : "0.0"}
                      %
                    </div>
                    <div className="text-sm text-[#9a9b95]">
                      {selectedKOL.wins}W / {selectedKOL.losses}L
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#2a2b2b] bg-[#191a1a] p-4">
                    <div className="text-sm text-[#9a9b95] mb-1">Total Trades</div>
                    <div className="text-2xl font-bold">{selectedKOL.wins + selectedKOL.losses}</div>
                    <div className="text-sm text-[#9a9b95]">Completed trades</div>
                  </div>

                  <div className="rounded-lg border border-[#2a2b2b] bg-[#191a1a] p-4">
                    <div className="text-sm text-[#9a9b95] mb-1">Avg Profit/Trade</div>
                    <div className="text-2xl font-bold profit-green">
                      {selectedKOL.wins + selectedKOL.losses > 0
                        ? (selectedKOL.profit / (selectedKOL.wins + selectedKOL.losses)).toFixed(2)
                        : "0.00"}
                      {" "}
                      SOL
                    </div>
                    <div className="text-sm text-[#9a9b95]">Per trade</div>
                  </div>
                </div>

                <div className="rounded-lg border border-[#2a2b2b] bg-[#191a1a] p-4">
                  <div className="text-sm text-[#9a9b95] mb-2">Wallet Address</div>
                  <div className="flex items-center justify-between gap-3">
                    <code className="text-sm font-mono break-all">{selectedKOL.fullWallet}</code>
                    <button
                      type="button"
                      className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-[#2a2b2b]"
                      onClick={(e) => copyToClipboard(selectedKOL.fullWallet, e)}
                    >
                      {copiedWallet === selectedKOL.fullWallet ? (
                        <Check className="h-4 w-4 text-[#2eae5b]" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Link
                      href={`/kol/${encodeURIComponent(selectedKOL.fullWallet)}`}
                      className="rounded-md bg-[#2a2b2b] px-3 py-2 text-sm font-medium hover:bg-[#3a3b3b] transition-colors"
                    >
                      View activity & details
                    </Link>
                    {selectedKOL.twitterUrl ? (
                      <a
                        href={selectedKOL.twitterUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-[#2a2b2b] px-3 py-2 text-sm font-medium hover:bg-[#2a2b2b] transition-colors"
                      >
                        Twitter
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
