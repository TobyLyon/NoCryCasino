# Supabase Go-Live SQL Runlist

This repo contains multiple generations of SQL scripts. **Do not run `scripts/legacy/*`** (they are superseded).

Below is the **minimal ordered list** of SQL files you need to run in Supabase SQL Editor for production go-live.

## How to run

Run each file **top-to-bottom in order** in the Supabase SQL editor.

- These scripts are mostly `create ... if not exists` / `alter ... add column if not exists`, so they should be safe to re-run.
- If you already applied some of these in Supabase, you can still re-run them (idempotent).

---

## Profile A (recommended): Wager Markets + Tournaments (no Prediction Markets)

1. [scripts/v2_001_extensions.sql](./v2_001_extensions.sql)
2. [scripts/v2_002_triggers.sql](./v2_002_triggers.sql)
3. [scripts/v2_010_users.sql](./v2_010_users.sql)
4. [scripts/v2_020_kols.sql](./v2_020_kols.sql)
5. [scripts/v2_030_tx_events.sql](./v2_030_tx_events.sql)
6. [scripts/v2_031_tx_events_slim.sql](./v2_031_tx_events_slim.sql)
7. [scripts/v2_040_wagering.sql](./v2_040_wagering.sql)
8. [scripts/v2_050_wagering_settlement.sql](./v2_050_wagering_settlement.sql)
9. [scripts/v2_060_wagering_escrow.sql](./v2_060_wagering_escrow.sql)
10. [scripts/v2_080_snapshot_settlement.sql](./v2_080_snapshot_settlement.sql)
11. [scripts/v2_090_anti_manipulation.sql](./v2_090_anti_manipulation.sql)
12. [scripts/v2_100_fee_config.sql](./v2_100_fee_config.sql)
13. [scripts/v2_110_escrow_audit.sql](./v2_110_escrow_audit.sql)
14. [scripts/v2_120_wager_payout_idempotency.sql](./v2_120_wager_payout_idempotency.sql)
15. [scripts/v2_130_tournaments.sql](./v2_130_tournaments.sql)

---

## Profile B: Wager Markets + Tournaments + Prediction Markets

Run **Profile A** first, then run:

16. [scripts/v3_010_prediction_markets.sql](./v3_010_prediction_markets.sql)
17. [scripts/v3_020_prediction_rpc.sql](./v3_020_prediction_rpc.sql)
18. [scripts/v3_030_prediction_withdrawals.sql](./v3_030_prediction_withdrawals.sql)
19. [scripts/v3_040_prediction_round_lifecycle.sql](./v3_040_prediction_round_lifecycle.sql)
20. [scripts/v3_050_prediction_nonces.sql](./v3_050_prediction_nonces.sql)

### Important note (Prediction Markets)

`scripts/v3_010_prediction_markets.sql` may rename an older `public.escrow_deposits` table to `escrow_deposits_legacy` and then create the Prediction Markets version of `public.escrow_deposits`.

This is expected and required for `/api/pm/*` routes (they read the PM schema: `deposit_id`, `user_pubkey`, `round_scope`, `tx_sig`, etc.).

---

## Explicitly NOT required for go-live (currently)

- [scripts/v3_060_prediction_squads_custody.sql](./v3_060_prediction_squads_custody.sql)
  - Adds Squads custody columns + functions.
  - You confirmed **Squads custody mode is not needed for launch**.

- [scripts/v2_070_kol_entities.sql](./v2_070_kol_entities.sql)
  - Multi-wallet KOL entities.
  - Current app code uses `public.kols` directly; this migration is not referenced.

- `scripts/legacy/*`
  - Old schema setup scripts (superseded by the v2/v3 scripts).

---

## What this runlist covers

- Core identities: `public.users` (wallet-based PK), `public.kols`
- Helius ingestion: `public.tx_events`, `public.tx_event_wallets`, plus “slim” generated columns and `raw` select revokes
- Wager markets: `wager_markets`, `wager_orders`, payouts idempotency columns, snapshots + settlement metadata
- Escrow audit log: `escrow_audit_log`
- Tournaments: `tournaments`, `tournament_entries`, `escrow`, `tracked_wallets`, `tx_event_tracked_wallets`, plus tournament payout bookkeeping columns
- (Optional) Prediction markets: PM tables + RPC functions + withdrawals + round lifecycle helpers + request nonces
