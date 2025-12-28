"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"

export function WalletSearch() {
  const router = useRouter()
  const [value, setValue] = useState("")

  const go = () => {
    const v = value.trim()
    if (!v) return
    router.push(`/kol/${encodeURIComponent(v)}`)
  }

  return (
    <div className="w-full max-w-2xl mx-auto flex items-center gap-2">
      <div className="flex-1 relative">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go()
          }}
          placeholder="Enter wallet address"
          className="w-full h-10 rounded-md border border-border bg-background/40 px-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          type="button"
          onClick={go}
          className="absolute right-1 top-1 h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center"
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
