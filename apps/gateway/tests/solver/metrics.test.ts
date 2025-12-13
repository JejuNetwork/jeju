import { describe, it, expect, beforeEach } from 'bun:test';
import {
  recordIntentReceived,
  recordIntentEvaluated,
  recordIntentFilled,
  recordIntentSkipped,
  recordSettlementClaimed,
  recordSettlementFailed,
  updatePendingSettlements,
  updateLiquidity,
  getPrometheusMetrics,
  getMetricsJson,
  metricsRegistry,
} from '../../src/solver/metrics';

describe('OIF Solver Metrics', () => {
  // Note: metrics accumulate across tests since registry is a singleton
  // This is intentional - production metrics also accumulate

  describe('recordIntentReceived', () => {
    it('should increment counter for chain', () => {
      const before = getMetricsJson();
      const initialCount = before.counters['oif_intents_received_total']?.find(
        m => m.labels.chain === '1'
      )?.value || 0;
      
      recordIntentReceived(1);
      
      const after = getMetricsJson();
      const newCount = after.counters['oif_intents_received_total']?.find(
        m => m.labels.chain === '1'
      )?.value || 0;
      
      expect(newCount).toBe(initialCount + 1);
    });

    it('should track different chains separately', () => {
      recordIntentReceived(1);
      recordIntentReceived(42161);
      recordIntentReceived(1);
      
      const metrics = getMetricsJson();
      const chain1 = metrics.counters['oif_intents_received_total']?.find(
        m => m.labels.chain === '1'
      );
      const chain42161 = metrics.counters['oif_intents_received_total']?.find(
        m => m.labels.chain === '42161'
      );
      
      expect(chain1).toBeDefined();
      expect(chain42161).toBeDefined();
    });
  });

  describe('recordIntentEvaluated', () => {
    it('should track profitable evaluations', () => {
      recordIntentEvaluated(1, true);
      
      const metrics = getMetricsJson();
      const profitable = metrics.counters['oif_intents_evaluated_total']?.find(
        m => m.labels.chain === '1' && m.labels.profitable === 'true'
      );
      
      expect(profitable).toBeDefined();
      expect(profitable!.value).toBeGreaterThan(0);
    });

    it('should track unprofitable evaluations', () => {
      recordIntentEvaluated(1, false);
      
      const metrics = getMetricsJson();
      const unprofitable = metrics.counters['oif_intents_evaluated_total']?.find(
        m => m.labels.chain === '1' && m.labels.profitable === 'false'
      );
      
      expect(unprofitable).toBeDefined();
      expect(unprofitable!.value).toBeGreaterThan(0);
    });
  });

  describe('recordIntentFilled', () => {
    it('should increment fill counter', () => {
      const before = getMetricsJson();
      const initialCount = before.counters['oif_intents_filled_total']?.find(
        m => m.labels.source_chain === '1' && m.labels.dest_chain === '42161'
      )?.value || 0;
      
      recordIntentFilled(1, 42161, 5000, 150000n);
      
      const after = getMetricsJson();
      const newCount = after.counters['oif_intents_filled_total']?.find(
        m => m.labels.source_chain === '1' && m.labels.dest_chain === '42161'
      )?.value || 0;
      
      expect(newCount).toBe(initialCount + 1);
    });

    it('should record gas used', () => {
      recordIntentFilled(1, 10, 3000, 200000n);
      
      const metrics = getMetricsJson();
      const gasMetric = metrics.counters['oif_fill_gas_used']?.find(
        m => m.labels.chain === '10'
      );
      
      expect(gasMetric).toBeDefined();
      expect(gasMetric!.value).toBeGreaterThan(0);
    });

    it('should record duration histogram', () => {
      recordIntentFilled(1, 8453, 2500, 100000n);
      
      const metrics = getMetricsJson();
      const histogram = metrics.histograms['oif_fill_duration_seconds']?.find(
        m => m.labels.source_chain === '1' && m.labels.dest_chain === '8453'
      );
      
      expect(histogram).toBeDefined();
      expect(histogram!.count).toBeGreaterThan(0);
      expect(histogram!.sum).toBeGreaterThan(0);
    });
  });

  describe('recordIntentSkipped', () => {
    it('should track skip reasons', () => {
      recordIntentSkipped(1, 'insufficient_liquidity');
      recordIntentSkipped(1, 'gas_too_high');
      recordIntentSkipped(1, 'insufficient_liquidity');
      
      const metrics = getMetricsJson();
      const liquiditySkips = metrics.counters['oif_intents_skipped_total']?.find(
        m => m.labels.chain === '1' && m.labels.reason === 'insufficient_liquidity'
      );
      
      expect(liquiditySkips).toBeDefined();
      expect(liquiditySkips!.value).toBeGreaterThanOrEqual(2);
    });
  });

  describe('recordSettlementClaimed', () => {
    it('should track settlement claims', () => {
      recordSettlementClaimed(1, 1000000000000000000n);
      
      const metrics = getMetricsJson();
      const claims = metrics.counters['oif_settlements_claimed_total']?.find(
        m => m.labels.chain === '1'
      );
      
      expect(claims).toBeDefined();
      expect(claims!.value).toBeGreaterThan(0);
    });

    it('should accumulate profit', () => {
      const before = getMetricsJson();
      const initialProfit = before.counters['oif_solver_profit_wei_total']?.find(
        m => m.labels.chain === '1'
      )?.value || 0;
      
      recordSettlementClaimed(1, 500000000000000000n);
      
      const after = getMetricsJson();
      const newProfit = after.counters['oif_solver_profit_wei_total']?.find(
        m => m.labels.chain === '1'
      )?.value || 0;
      
      expect(newProfit).toBeGreaterThan(initialProfit);
    });
  });

  describe('recordSettlementFailed', () => {
    it('should track failure reasons', () => {
      recordSettlementFailed(1, 'not_attested');
      
      const metrics = getMetricsJson();
      const failures = metrics.counters['oif_settlements_failed_total']?.find(
        m => m.labels.chain === '1' && m.labels.reason === 'not_attested'
      );
      
      expect(failures).toBeDefined();
      expect(failures!.value).toBeGreaterThan(0);
    });
  });

  describe('updatePendingSettlements', () => {
    it('should set gauge value', () => {
      updatePendingSettlements(5);
      
      const metrics = getMetricsJson();
      expect(metrics.gauges['oif_settlements_pending']).toBe(5);
    });

    it('should update gauge to new value', () => {
      updatePendingSettlements(10);
      expect(getMetricsJson().gauges['oif_settlements_pending']).toBe(10);
      
      updatePendingSettlements(3);
      expect(getMetricsJson().gauges['oif_settlements_pending']).toBe(3);
    });
  });

  describe('getPrometheusMetrics', () => {
    it('should return valid Prometheus format', () => {
      // Record some metrics first
      recordIntentReceived(1);
      recordIntentFilled(1, 10, 1000, 50000n);
      updatePendingSettlements(2);
      
      const output = getPrometheusMetrics();
      
      expect(output).toContain('# HELP');
      expect(output).toContain('# TYPE');
      expect(output).toContain('oif_intents_received_total');
    });

    it('should format counters correctly', () => {
      recordIntentReceived(999);
      
      const output = getPrometheusMetrics();
      
      expect(output).toContain('oif_intents_received_total{chain="999"}');
    });

    it('should format histograms with buckets', () => {
      recordIntentFilled(999, 998, 500, 10000n);
      
      const output = getPrometheusMetrics();
      
      expect(output).toContain('oif_fill_duration_seconds_bucket');
      expect(output).toContain('oif_fill_duration_seconds_sum');
      expect(output).toContain('oif_fill_duration_seconds_count');
      expect(output).toContain('le="+Inf"');
    });

    it('should format gauges correctly', () => {
      updatePendingSettlements(7);
      
      const output = getPrometheusMetrics();
      
      expect(output).toContain('oif_settlements_pending 7');
    });
  });

  describe('getMetricsJson', () => {
    it('should return structured metrics object', () => {
      const metrics = getMetricsJson();
      
      expect(metrics).toHaveProperty('counters');
      expect(metrics).toHaveProperty('histograms');
      expect(metrics).toHaveProperty('gauges');
    });

    it('should return empty arrays for metrics without data', () => {
      const metrics = getMetricsJson();
      
      // These might have data from previous tests, but structure should be correct
      expect(typeof metrics.counters).toBe('object');
      expect(typeof metrics.histograms).toBe('object');
      expect(typeof metrics.gauges).toBe('object');
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero duration', () => {
      recordIntentFilled(1, 10, 0, 100000n);
      
      const metrics = getMetricsJson();
      const histogram = metrics.histograms['oif_fill_duration_seconds'];
      expect(histogram).toBeDefined();
    });

    it('should handle very large gas values', () => {
      const largeGas = 9007199254740991n; // Max safe integer as bigint
      recordIntentFilled(1, 10, 1000, largeGas);
      
      const metrics = getMetricsJson();
      expect(metrics.counters['oif_fill_gas_used']).toBeDefined();
    });

    it('should handle empty reason strings', () => {
      recordIntentSkipped(1, '');
      recordSettlementFailed(1, '');
      
      const metrics = getMetricsJson();
      expect(metrics.counters['oif_intents_skipped_total']).toBeDefined();
      expect(metrics.counters['oif_settlements_failed_total']).toBeDefined();
    });
  });
});
