/**
 * Perpetuals Trading Strategies
 *
 * Bot strategies for perpetual futures trading:
 * - Funding rate arbitrage
 * - Liquidation hunting
 * - Market making
 */

export { type FundingArbConfig, FundingArbitrageBot } from './funding-arbitrage'
export { LiquidationBot, type LiquidationBotConfig } from './liquidation-bot'
