"use client"

import { Button } from "@/components/ui/button"
import { useState } from "react"

const ENTRY_FEE_TIERS = [
  { label: "All Stakes", value: null },
  { label: "0.05 SOL", value: 0.05, badge: "Micro" },
  { label: "0.1 SOL", value: 0.1, badge: "Low" },
  { label: "0.2 SOL", value: 0.2, badge: "Medium" },
  { label: "0.5 SOL", value: 0.5, badge: "High" },
  { label: "1 SOL", value: 1.0, badge: "Elite" },
]

const JACKPOT_RANGES = [
  { label: "All Prizes", value: null },
  { label: "< 0.5 SOL", value: { min: 0, max: 0.5 } },
  { label: "1-4 SOL", value: { min: 1, max: 4 } },
  { label: "5-10 SOL", value: { min: 5, max: 10 } },
  { label: "10-20 SOL", value: { min: 10, max: 20 } },
  { label: "20-50 SOL", value: { min: 20, max: 50 } },
  { label: "50+ SOL", value: { min: 50, max: Number.POSITIVE_INFINITY } },
]

const STATUS_FILTERS = [
  { label: "All", value: null },
  { label: "Live", value: "live" },
  { label: "Upcoming", value: "upcoming" },
]

interface TournamentFiltersProps {
  onFilterChange?: (filters: {
    entryFee: number | null
    jackpot: { min: number; max: number } | null
    status: string | null
  }) => void
}

export function TournamentFilters({ onFilterChange }: TournamentFiltersProps) {
  const [selectedEntryFee, setSelectedEntryFee] = useState<number | null>(null)
  const [selectedJackpot, setSelectedJackpot] = useState<{ min: number; max: number } | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)

  const handleEntryFeeChange = (value: number | null) => {
    setSelectedEntryFee(value)
    onFilterChange?.({ entryFee: value, jackpot: selectedJackpot, status: selectedStatus })
  }

  const handleJackpotChange = (value: { min: number; max: number } | null) => {
    setSelectedJackpot(value)
    onFilterChange?.({ entryFee: selectedEntryFee, jackpot: value, status: selectedStatus })
  }

  const handleStatusChange = (value: string | null) => {
    setSelectedStatus(value)
    onFilterChange?.({ entryFee: selectedEntryFee, jackpot: selectedJackpot, status: value })
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-2 text-muted-foreground">Entry Fee</h3>
        <div className="flex flex-wrap gap-2">
          {ENTRY_FEE_TIERS.map((tier) => (
            <Button
              key={tier.label}
              variant={selectedEntryFee === tier.value ? "default" : "outline"}
              size="sm"
              onClick={() => handleEntryFeeChange(tier.value)}
            >
              {tier.label}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2 text-muted-foreground">Jackpot (Prize Pool)</h3>
        <div className="flex flex-wrap gap-2">
          {JACKPOT_RANGES.map((range) => (
            <Button
              key={range.label}
              variant={selectedJackpot === range.value ? "default" : "outline"}
              size="sm"
              onClick={() => handleJackpotChange(range.value)}
            >
              {range.label}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2 text-muted-foreground">Status</h3>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((filter) => (
            <Button
              key={filter.label}
              variant={selectedStatus === filter.value ? "default" : "outline"}
              size="sm"
              onClick={() => handleStatusChange(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
