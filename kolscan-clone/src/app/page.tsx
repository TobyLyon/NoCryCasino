'use client';

import { useState, useMemo } from 'react';
import { Search, Settings, Copy, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getKOLsByTimeframe, type KOL } from '@/lib/kol-data';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

type TimeFrame = 'daily' | 'weekly' | 'monthly';

export default function Home() {
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('daily');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null);
  const [selectedKOL, setSelectedKOL] = useState<KOL | null>(null);

  // Get KOLs based on selected timeframe
  const kols = getKOLsByTimeframe(timeFrame);

  // Filter KOLs based on search query
  const filteredKOLs = useMemo(() => {
    if (!searchQuery) return kols;
    const query = searchQuery.toLowerCase();
    return kols.filter(
      (kol) =>
        kol.name.toLowerCase().includes(query) ||
        kol.wallet.toLowerCase().includes(query) ||
        kol.fullWallet.toLowerCase().includes(query)
    );
  }, [kols, searchQuery]);

  // Copy wallet to clipboard
  const copyToClipboard = async (wallet: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(wallet);
    setCopiedWallet(wallet);
    setTimeout(() => setCopiedWallet(null), 2000);
  };

  return (
    <div className="min-h-screen bg-[#191a1a] text-[#d5d6d0]">
      {/* Header */}
      <header className="border-b border-[#2a2b2b] px-4 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-xl font-bold">Kolscan</h1>
            <div className="flex items-center gap-2 rounded-lg border border-[#2a2b2b] px-3 py-1.5 text-sm">
              <img
                src="https://ext.same-assets.com/3959085109/2433917169.svg"
                alt="menu"
                className="h-4 w-4"
              />
              <span>$123.88</span>
            </div>
            <nav className="hidden md:flex items-center gap-6 text-sm">
              <a href="#" className="hover:text-white transition-colors">
                Trades
              </a>
              <a href="#" className="hover:text-white transition-colors">
                Tokens
              </a>
              <a href="#" className="font-medium text-white">
                Leaderboard
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://join.pump.fun/HSag/kolscan"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:flex items-center gap-2 rounded-lg bg-[#22702c] px-4 py-2 text-sm font-medium hover:bg-[#2a8537] transition-colors"
            >
              <img
                src="https://ext.same-assets.com/3959085109/360094221.webp"
                alt="pump"
                className="h-4 w-4"
              />
              Pump app
            </a>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 hover:bg-[#2a2b2b]"
              onClick={() => setSearchOpen(!searchOpen)}
            >
              <Search className="h-5 w-5" />
            </Button>
            <WalletMultiButton className="!bg-[#4870a0] hover:!bg-[#5580b0] !text-white !font-medium !h-9 !rounded-md !px-4 !text-sm" />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 hover:bg-[#2a2b2b]"
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Search Bar */}
      {searchOpen && (
        <div className="border-b border-[#2a2b2b] bg-[#1f2020] px-4 py-3">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <Search className="h-5 w-5 text-[#9a9b95]" />
            <Input
              type="text"
              placeholder="Search by name or wallet address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 border-[#2a2b2b] bg-[#191a1a] text-white placeholder:text-[#9a9b95]"
              autoFocus
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 hover:bg-[#2a2b2b]"
              onClick={() => {
                setSearchOpen(false);
                setSearchQuery('');
              }}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
          {/* Leaderboard Section */}
          <div>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold">KOL Leaderboard</h2>
              <div className="flex gap-2 rounded-lg border border-[#2a2b2b] p-1">
                <button
                  onClick={() => setTimeFrame('daily')}
                  className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
                    timeFrame === 'daily'
                      ? 'bg-[#2a2b2b] text-white'
                      : 'text-[#d5d6d0] hover:text-white'
                  }`}
                >
                  Daily
                </button>
                <button
                  onClick={() => setTimeFrame('weekly')}
                  className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
                    timeFrame === 'weekly'
                      ? 'bg-[#2a2b2b] text-white'
                      : 'text-[#d5d6d0] hover:text-white'
                  }`}
                >
                  Weekly
                </button>
                <button
                  onClick={() => setTimeFrame('monthly')}
                  className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
                    timeFrame === 'monthly'
                      ? 'bg-[#2a2b2b] text-white'
                      : 'text-[#d5d6d0] hover:text-white'
                  }`}
                >
                  Monthly
                </button>
              </div>
            </div>

            {/* Results count */}
            {searchQuery && (
              <div className="mb-4 text-sm text-[#9a9b95]">
                Found {filteredKOLs.length} result{filteredKOLs.length !== 1 ? 's' : ''}
              </div>
            )}

            {/* Leaderboard List */}
            <div className="space-y-3">
              {filteredKOLs.length > 0 ? (
                filteredKOLs.map((kol) => (
                  <div
                    key={kol.fullWallet}
                    onClick={() => setSelectedKOL(kol)}
                    className={`flex items-center gap-4 rounded-xl border border-[#2a2b2b] p-4 transition-all hover:border-[#3a3b3b] cursor-pointer ${
                      kol.rank === 1 ? 'gold-gradient' : 'bg-[#1f2020]'
                    }`}
                  >
                    {/* Rank */}
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

                    {/* Avatar & Name */}
                    <div className="flex items-center gap-3">
                      <img
                        src={kol.avatar}
                        alt={kol.name}
                        className="h-10 w-10 rounded-full border-2 border-[#3a3b3b]"
                      />
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{kol.name}</span>
                        {kol.hasTwitter && (
                          <img
                            src="https://ext.same-assets.com/3959085109/2214575193.webp"
                            alt="twitter"
                            className="h-4 w-4 opacity-70"
                          />
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

                    {/* Wallet with copy button */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[#9a9b95]">{kol.wallet}</span>
                      <button
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

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Win/Loss */}
                    <div className="text-sm">
                      <span className="text-[#2eae5b]">{kol.wins}</span>
                      <span className="text-[#9a9b95]">/</span>
                      <span className="text-[#d87373]">{kol.losses}</span>
                    </div>

                    {/* Profit */}
                    <div className="text-right">
                      <div className="font-semibold text-[#2eae5b]">
                        +{kol.profit.toFixed(2)} Sol
                      </div>
                      <div className="text-sm text-[#2eae5b]">
                        ($
                        {kol.profitUsd.toLocaleString('en-US', {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}
                        )
                      </div>
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

          {/* Right Sidebar */}
          <div className="hidden lg:block">
            <div className="sticky top-8 rounded-xl border border-[#2a2b2b] bg-[#1f2020] p-6">
              <h3 className="mb-4 text-lg font-bold">Pump Leaderboard</h3>
              <div className="mb-4 flex justify-center">
                <div className="rounded-lg bg-white p-4">
                  <img
                    src="https://ext.same-assets.com/3959085109/689289039.svg"
                    alt="QR Code"
                    className="h-40 w-40"
                  />
                </div>
              </div>
              <p className="mb-4 text-center text-sm text-[#9a9b95]">
                Scan to download app
              </p>
              <a
                href="https://join.pump.fun/HSag/kolscan"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-lg bg-[#22702c] py-2.5 text-center font-medium hover:bg-[#2a8537] transition-colors"
              >
                Learn more
              </a>
            </div>
          </div>
        </div>
      </main>

      {/* KOL Detail Modal */}
      <Dialog open={!!selectedKOL} onOpenChange={() => setSelectedKOL(null)}>
        <DialogContent className="bg-[#1f2020] border-[#2a2b2b] text-[#d5d6d0] max-w-2xl">
          {selectedKOL && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-4">
                  <img
                    src={selectedKOL.avatar}
                    alt={selectedKOL.name}
                    className="h-16 w-16 rounded-full border-2 border-[#3a3b3b]"
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
                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-[#2a2b2b] bg-[#191a1a] p-4">
                    <div className="text-sm text-[#9a9b95] mb-1">Total Profit</div>
                    <div className="text-2xl font-bold text-[#2eae5b]">
                      +{selectedKOL.profit.toFixed(2)} SOL
                    </div>
                    <div className="text-sm text-[#2eae5b]">
                      $
                      {selectedKOL.profitUsd.toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#2a2b2b] bg-[#191a1a] p-4">
                    <div className="text-sm text-[#9a9b95] mb-1">Win Rate</div>
                    <div className="text-2xl font-bold">
                      {((selectedKOL.wins / (selectedKOL.wins + selectedKOL.losses)) * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm text-[#9a9b95]">
                      {selectedKOL.wins}W / {selectedKOL.losses}L
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#2a2b2b] bg-[#191a1a] p-4">
                    <div className="text-sm text-[#9a9b95] mb-1">Total Trades</div>
                    <div className="text-2xl font-bold">
                      {selectedKOL.wins + selectedKOL.losses}
                    </div>
                    <div className="text-sm text-[#9a9b95]">Completed trades</div>
                  </div>

                  <div className="rounded-lg border border-[#2a2b2b] bg-[#191a1a] p-4">
                    <div className="text-sm text-[#9a9b95] mb-1">Avg Profit/Trade</div>
                    <div className="text-2xl font-bold text-[#2eae5b]">
                      {(selectedKOL.profit / (selectedKOL.wins + selectedKOL.losses)).toFixed(2)} SOL
                    </div>
                    <div className="text-sm text-[#9a9b95]">Per trade</div>
                  </div>
                </div>

                {/* Wallet Address */}
                <div className="rounded-lg border border-[#2a2b2b] bg-[#191a1a] p-4">
                  <div className="text-sm text-[#9a9b95] mb-2">Wallet Address</div>
                  <div className="flex items-center justify-between gap-3">
                    <code className="text-sm font-mono break-all">{selectedKOL.fullWallet}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={(e) => copyToClipboard(selectedKOL.fullWallet, e)}
                    >
                      {copiedWallet === selectedKOL.fullWallet ? (
                        <Check className="h-4 w-4 text-[#2eae5b]" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Social Links */}
                <div className="flex items-center gap-3">
                  {selectedKOL.hasTwitter && (
                    <a
                      href="#"
                      className="flex items-center gap-2 rounded-lg border border-[#2a2b2b] bg-[#191a1a] px-4 py-2 hover:border-[#3a3b3b] transition-colors"
                    >
                      <img
                        src="https://ext.same-assets.com/3959085109/2214575193.webp"
                        alt="twitter"
                        className="h-5 w-5"
                      />
                      <span className="text-sm">Twitter</span>
                    </a>
                  )}
                  {selectedKOL.hasTelegram && (
                    <a
                      href="#"
                      className="flex items-center gap-2 rounded-lg border border-[#2a2b2b] bg-[#191a1a] px-4 py-2 hover:border-[#3a3b3b] transition-colors"
                    >
                      <img
                        src="https://ext.same-assets.com/3959085109/1422258496.webp"
                        alt="telegram"
                        className="h-5 w-5"
                      />
                      <span className="text-sm">Telegram</span>
                    </a>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <footer className="mt-16 border-t border-[#2a2b2b] py-6">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-[#9a9b95]">
          2025 Kolscan. All rights reserved. |{' '}
          <a href="#" className="hover:text-white transition-colors">
            Privacy
          </a>{' '}
          |{' '}
          <a href="#" className="hover:text-white transition-colors">
            Terms of Use
          </a>
        </div>
      </footer>
    </div>
  );
}
