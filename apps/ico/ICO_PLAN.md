# JEJU ICO PLAN

## Public Token Sale Strategy

**Version:** 1.0  
**Date:** December 2024  
**Status:** Draft Plan

---

## EXECUTIVE SUMMARY

Jeju Network will conduct a public token sale (ICO) for 10% of total token supply (1B tokens) through the Jeju platform. The sale occurs simultaneously with ecosystem launch and governance activation, creating a unified launch event. Proceeds fund Agent Council operations and platform expansion, providing 18+ months of runway.

**Key Objectives:**

- Raise operating capital ($3M+ target)
- Community-friendly distribution using Uniswap CCA on Jeju L2
- Unified launch experience (presale + governance + ecosystem on same platform)
- Establish liquidity on Jeju DEX from day one
- Enable moderation staking and governance participation

---

## 1. SALE STRUCTURE & MECHANICS

### Token Allocation

**Public Sale:** 10% of total supply (1B tokens)

| Allocation | % | Tokens | Vesting |
|------------|---|--------|---------|
| Presale | 10% | 1,000,000,000 | 20% TGE, 180-day linear |
| Ecosystem | 30% | 3,000,000,000 | 1-year cliff, 4-year linear |
| Agent Council | 25% | 2,500,000,000 | 5% TGE, 6-month cliff, 5-year linear |
| Team | 15% | 1,500,000,000 | 1-year cliff, 4-year linear |
| Liquidity | 10% | 1,000,000,000 | 100% at TGE |
| Community | 10% | 1,000,000,000 | 10% TGE, 3-year linear |

### Sale Execution via Uniswap Continuous Clearing Auctions (CCA)

**Platform:** Uniswap CCA on Jeju L2 - DeFi native, fully onchain token distribution

**Timing:** Same day as ecosystem launch and governance activation

- **Target Date:** Q1 2025
- **Auction Duration:** 7 days
- **Access:** Open participation (no gatekeeping, paymaster-enabled for any token)

**How CCA Works:**

1. **Commit Supply:** Jeju commits 1B tokens (10% of supply) to public auction, sets duration and floor price
2. **Price Discovery:** Bidders place orders split across auction blocks, each block clears at identified market price
3. **Liquidity from Day One:** At auction end, tokens distributed and Jeju DEX pool created at discovered price

**CCA Benefits:**

- Market-driven pricing rooted in demand
- Fully onchain and transparent (auditable on Jeju L2)
- Fair and decentralized - no gatekept distributions
- Immediate liquidity on Jeju DEX
- Paymaster support - bid with any supported token

### Customizable Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Token supply | 1,000,000,000 | 10% of total |
| Auction duration | 7 days | Configurable |
| Floor price | $0.003 | ~$3M soft cap |
| Min contribution | 0.01 ETH | Low barrier |
| Max contribution | 50 ETH | Anti-whale |
| Whitelist bonus | 10% | Early supporters |
| Volume bonuses | 1-5% | 1+ ETH tiers |

### Token Details

| Property | Value |
|----------|-------|
| Total Supply | 10,000,000,000 (fixed) |
| Sale Allocation | 1,000,000,000 (10%) |
| Initial Price | ~$0.003 (CCA discovered) |
| Token Standard | ERC-20 on Jeju L2 |
| Chain | Jeju Network (OP-Stack L2) |
| Chain ID | 420691 (mainnet) / 420690 (testnet) |

### Trading & Liquidity

**Primary Liquidity:** Jeju DEX (Uniswap v4 fork)

- CCA automatically creates JEJU/ETH pool at discovered price
- Liquidity seeded from day one
- 200ms Flashblocks for near-instant settlement
- Paymaster-enabled trading (gas in any token)

**Secondary Markets:**

- Jeju Bazaar prediction markets
- Cross-chain via EIL (Ethereum Interop Layer)
- CEX listings after initial sale
- Additional DEX via bridge

**Liquidity Strategy:** 10% allocation (1B tokens) for:
- Initial DEX liquidity
- Market-making bots
- Cross-chain pools
- Exchange listings

---

## 2. TIMELINE & MILESTONES

### Pre-ICO (Current - Q1 2025)

- [x] Infrastructure (Jeju L2, contracts, platform)
- [x] Presale contract development and testing
- [x] ICO app with tokenomics display
- [ ] Legal review and entity setup
- [ ] Uniswap CCA integration on Jeju
- [ ] Marketing campaign
- [ ] CCA parameter finalization

### ICO Phase (Q1 2025)

- **Launch Day:** Points conversion, presale opens, platform live
- **Duration:** 7-day CCA auction
- **Post-Auction:** Immediate liquidity, trading begins
- **Transition:** 180-day vesting for presale participants

### Post-ICO (Q1 2025+)

- Governance activation (Agent Council)
- Moderation marketplace live
- Ecosystem expansion (Compute, Storage, Bazaar)
- CEX listings
- Cross-chain deployment

---

## 3. JEJU TOKEN UTILITY

### Exclusive JEJU Functions

| Function | Description |
|----------|-------------|
| **Governance** | Vote on protocol upgrades, parameters, treasury |
| **Moderation Staking** | Stake in futarchy-based ModerationMarketplace |
| **Ban Enforcement** | Banned users cannot transfer JEJU (conviction lock) |

### Universal Payment (Any Token)

All network services accept any paymaster-registered token:

- Compute (inference, TEE)
- Storage (IPFS pinning)
- Bazaar (marketplace fees)
- Gateway (API access)

**"Most Favored Nations" Policy:** JEJU has no payment preference in contracts - only exclusive utility in governance and moderation.

### Agent Council

All network revenue flows to the Agent Council multi-sig:
- Protocol development funding
- Infrastructure operations
- Ecosystem grants
- Emergency response

---

## 4. COMPLIANCE & LEGAL

### Regulatory Framework

| Area | Approach |
|------|----------|
| Classification | Utility token (MiCA Article 3(1)(5)) |
| Jurisdictions | EU-friendly, legal review for US/Asia |
| KYC/AML | Optional (open participation default) |
| Entity | Jeju Network Foundation (to be established) |
| Right of Withdrawal | 14-day window per MiCA |
| Refund | Auto-refund if soft cap not reached |

### Documentation

- [x] Whitepaper with MiCA compliance
- [ ] Terms of sale
- [ ] Token sale agreement
- [ ] Risk disclosures
- [ ] Regulatory filings

### Environmental Disclosure

- Jeju L2 on PoS Ethereum
- <0.01 kg CO2 per transaction
- 200ms Flashblocks (energy efficient)

---

## 5. RISK MITIGATION & SUCCESS METRICS

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Legal | Pre-launch legal review, utility token model |
| Technical | Audited contracts, battle-tested infrastructure |
| Market | CCA price discovery, no arbitrary pricing |
| Security | Multi-sig ownership, audited code |
| Adoption | Existing ecosystem, community foundation |

### Success Metrics

| Metric | Target |
|--------|--------|
| Total Raise | $3M+ |
| Participants | 5,000+ |
| Liquidity Depth | $500K+ TVL |
| Trading Volume | $100K+ daily |
| Governance Participation | 20%+ of supply staked |

---

## 6. OPEN ITEMS & NEXT STEPS

### Open Items

| Item | Status | Notes |
|------|--------|-------|
| Auction Duration | TBD | 7 days recommended |
| Floor Price | TBD | ~$0.003 for $3M target |
| KYC Requirements | TBD | Open participation preferred |
| Legal Structure | TBD | Foundation vs DAO |
| Auditor Selection | TBD | Pre-mainnet audit required |

### Next Steps

**Immediate (December 2024):**

- [ ] Contact Uniswap CCA team for integration
- [ ] Finalize CCA parameters
- [ ] Legal review initiation
- [ ] Marketing campaign planning

**Short-term (January 2025):**

- [ ] Complete CCA integration on Jeju
- [ ] Security audits
- [ ] Legal documentation
- [ ] Community education
- [ ] Testnet public testing

**Launch (Q1 2025):**

- [ ] Final compliance checks
- [ ] Launch day execution
- [ ] Community support
- [ ] Post-ICO governance activation

---

## APPENDIX

### Contract Addresses (Testnet)

| Contract | Address |
|----------|---------|
| JejuToken | `0x...` (TBD) |
| JejuPresale | `0x...` (TBD) |
| BanManager | `0x...` (TBD) |
| ModerationMarketplace | `0x...` (TBD) |

### Resources

- [Whitepaper](/whitepaper)
- [GitHub](https://github.com/elizaos/jeju)
- [Documentation](https://docs.jeju.network)
- [Testnet](https://testnet.jeju.network)

---

**END OF DOCUMENT**

This ICO plan provides the framework for Jeju's public token sale. Final decisions on open items to be made through team discussion and legal/compliance review.
