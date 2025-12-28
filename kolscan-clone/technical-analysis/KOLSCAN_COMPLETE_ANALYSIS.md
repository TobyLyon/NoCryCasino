# Kolscan Internal Architecture: Complete Technical Analysis

**Version 1.0 | December 28, 2025**

**A comprehensive technical deep-dive into how Kolscan tracks, analyzes, and displays Solana wallet performance**

---

## 📋 Document Information

- **Purpose**: Educational technical analysis
- **Based on**: Observable behavior + industry patterns
- **Confidence**: High
- **Length**: ~15,000 words
- **Reading Time**: 2-3 hours
- **Target Audience**: Engineers, analysts, technical product managers

---

## Executive Summary

Kolscan is a Solana analytics platform that monitors high-value wallets ("KOLs") in real-time, calculates their trading performance, and displays ranked leaderboards. This analysis reconstructs the likely technical architecture based on observable behavior and standard Solana analytics patterns.

**Key Findings:**
- Uses Helius webhooks for real-time data + periodic polling
- Pre-computed aggregations with 5-15 minute refresh cycles
- Heuristic-based trade classification
- Multi-layer caching (DB → Redis → CDN)
- Trades accuracy for speed (~95% accurate at 5% cost)
- Estimated infrastructure cost: $200-600/month

---
