import { describe, expect, it } from "vitest"
import { computeRealizedTradePnL, computeTradeSolChangeLamports, extractTradeLeg, isTradeLike } from "@/lib/analytics/kolscan-pnl"

describe("kolscan-pnl", () => {
  it("computes realized PnL with weighted-average cost basis and proportional reduction on partial sells", () => {
    const t0 = 1_000
    const legs = [
      // buy 100 tokens for 1 SOL
      { token_mint: "MINT", side: "buy" as const, token_amount: 100, sol_change_lamports: -1_000_000_000, block_time_ms: t0 },
      // buy 100 tokens for 3 SOL (avg cost now 0.02 SOL/token)
      { token_mint: "MINT", side: "buy" as const, token_amount: 100, sol_change_lamports: -3_000_000_000, block_time_ms: t0 + 1 },
      // sell 50 tokens for 2 SOL, cost basis = 50 * 0.02 = 1 SOL => profit 1 SOL
      { token_mint: "MINT", side: "sell" as const, token_amount: 50, sol_change_lamports: 2_000_000_000, block_time_ms: t0 + 2 },
      // sell remaining 150 tokens for 3 SOL, remaining cost basis = 3 SOL => profit 0
      { token_mint: "MINT", side: "sell" as const, token_amount: 150, sol_change_lamports: 3_000_000_000, block_time_ms: t0 + 3 },
    ]

    const out = computeRealizedTradePnL(legs)
    expect(out.realized_lamports).toBe(1_000_000_000)
    expect(out.wins).toBe(1)
    expect(out.losses).toBe(0)
    expect(out.tx_count).toBe(4)
  })

  it("excludes tx fee from SOL delta when wallet is feePayer", () => {
    const wallet = "WALLET"
    const raw = {
      fee: 10_000,
      feePayer: wallet,
      accountData: [{ account: wallet, nativeBalanceChange: -1_000_010_000 }],
      tokenTransfers: [],
      events: {},
    }

    const lamports = computeTradeSolChangeLamports(raw, wallet, 100)
    expect(lamports).toBe(-1_000_000_000)
  })

  it("uses WSOL delta when present (treat wrap/unwrap as SOL)", () => {
    const wallet = "WALLET"
    const raw = {
      tokenTransfers: [{ mint: "So11111111111111111111111111111111111111112", tokenAmount: 1, fromUserAccount: wallet, toUserAccount: "X" }],
      events: {},
    }

    const lamports = computeTradeSolChangeLamports(raw, wallet, 100)
    expect(lamports).toBe(-1_000_000_000)
  })

  it("extractTradeLeg picks the primary non-stable token delta and assigns side", () => {
    const wallet = "WALLET"
    const raw = {
      fee: 0,
      feePayer: wallet,
      accountData: [{ account: wallet, nativeBalanceChange: -2_000_000_000 }],
      tokenTransfers: [
        { mint: "TOKEN_A", tokenAmount: 10, toUserAccount: wallet },
        { mint: "TOKEN_B", tokenAmount: 1, toUserAccount: wallet },
      ],
      events: {},
    }

    const leg = extractTradeLeg(raw, wallet, 123, 100)
    expect(leg?.token_mint).toBe("TOKEN_A")
    expect(leg?.side).toBe("buy")
    expect(leg?.token_amount).toBe(10)
  })

  it("treats stable-routed swaps as trade-like (stable as routing)", () => {
    const wallet = "WALLET"
    const raw = {
      source: "JUPITER",
      type: "TRANSFER",
      tokenTransfers: [
        { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", tokenAmount: 100, fromUserAccount: wallet, toUserAccount: "X" },
        { mint: "TOKEN_A", tokenAmount: 10, toUserAccount: wallet },
      ],
      events: {},
    }

    expect(isTradeLike(raw, wallet)).toBe(true)
  })
})
