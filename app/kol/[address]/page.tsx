import { Header } from "@/components/header"
import { WalletTxFeed } from "@/components/kolscan/wallet-tx-feed"
import { Card } from "@/components/ui/card"

export default async function KolPage({ params }: { params: { address: string } }) {
  const address = decodeURIComponent(params.address)

  return (
    <div className="min-h-screen">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <div className="text-sm text-muted-foreground">Wallet</div>
          <h1 className="text-2xl font-semibold font-mono break-all">{address}</h1>
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">
            <Card className="p-5 border-border/60 bg-card/70">
              <div className="text-sm text-muted-foreground">PnL / Token breakdown</div>
              <div className="mt-2 text-sm text-muted-foreground">Coming next (computed from stored trades + price snapshots).</div>
            </Card>

            <div>
              <div className="text-sm font-semibold mb-2">Recent activity</div>
              <WalletTxFeed walletAddress={address} />
            </div>
          </div>

          <div className="space-y-6">
            <Card className="p-5 border-border/60 bg-card/70">
              <div className="text-sm font-semibold mb-2">Stats</div>
              <div className="text-sm text-muted-foreground">Coming next.</div>
            </Card>

            <Card className="p-5 border-border/60 bg-card/70">
              <div className="text-sm font-semibold mb-2">Links</div>
              <div className="text-sm text-muted-foreground">Twitter/Telegram mapping will live here.</div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}
