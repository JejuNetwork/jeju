/**
 * TFMM (Temporal Function Market Maker) Strategies
 * 
 * QuantAMM-style dynamic weight strategies for on-chain portfolio management.
 */

export { BaseTFMMStrategy } from './base-strategy';
export type { 
  StrategyContext, 
  PriceHistory, 
  WeightCalculation, 
  StrategySignal 
} from './base-strategy';

export { MomentumStrategy } from './momentum-strategy';
export type { MomentumConfig } from './momentum-strategy';

export { MeanReversionStrategy } from './mean-reversion-strategy';
export type { MeanReversionConfig } from './mean-reversion-strategy';

export { VolatilityStrategy } from './volatility-strategy';
export type { VolatilityConfig } from './volatility-strategy';

export { CompositeStrategy } from './composite-strategy';
export type { CompositeConfig, MarketRegime } from './composite-strategy';

export { TFMMRebalancer } from './rebalancer';
export type { TFMMRebalancerConfig, RebalanceResult } from './rebalancer';

