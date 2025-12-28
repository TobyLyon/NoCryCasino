"use client"

import { Button } from "@/components/ui/button"

export function LeaderboardFilters() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="default" size="sm">
        All Time
      </Button>
      <Button variant="outline" size="sm">
        This Month
      </Button>
      <Button variant="outline" size="sm">
        This Week
      </Button>
      <Button variant="outline" size="sm">
        Today
      </Button>
    </div>
  )
}
