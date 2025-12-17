/**
 * Perpetuals Trading Strategies
 * 
 * Bot strategies for perpetual futures trading:
 * - Funding rate arbitrage
 * - Liquidation hunting
 * - Market making
 */

export { FundingArbitrageBot, type FundingArbConfig } from './funding-arbitrage';
export { LiquidationBot, type LiquidationBotConfig } from './liquidation-bot';

