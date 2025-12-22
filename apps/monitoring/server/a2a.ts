/**
 * A2A (Agent-to-Agent) server for network monitoring
 * 
 * Exposes Prometheus metrics and network health status via the A2A protocol.
 */

import { getNetworkName } from '@jejunetwork/config';
import { z } from 'zod';
import express from 'express';
import cors from 'cors';
import {
  A2ARequestSchema,
  PrometheusQueryResultSchema,
  PrometheusAlertsResponseSchema,
  PrometheusTargetsResponseSchema,
  OIFStatsResponseSchema,
  OIFSolverSchema,
  OIFRouteSchema,
} from '../types';

const networkName = getNetworkName();

const app = express();
app.use(cors());
app.use(express.json());

const PROMETHEUS_URL = process.env.PROMETHEUS_URL;
const OIF_AGGREGATOR_URL = process.env.OIF_AGGREGATOR_URL;

if (!PROMETHEUS_URL) {
  console.warn('⚠️ PROMETHEUS_URL not set, defaulting to http://localhost:9090');
}
if (!OIF_AGGREGATOR_URL) {
  console.warn('⚠️ OIF_AGGREGATOR_URL not set, defaulting to http://localhost:4010');
}

const prometheusUrl = PROMETHEUS_URL ?? 'http://localhost:9090';
const oifAggregatorUrl = OIF_AGGREGATOR_URL ?? 'http://localhost:4010';

function formatVolume(amount: string): string {
  const value = parseFloat(amount) / 1e18;
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K`;
  return value.toFixed(4);
}

app.get('/.well-known/agent-card.json', (_req, res) => {
  res.json({
    protocolVersion: '0.3.0',
    name: `${networkName} Monitoring`,
    description: 'Query blockchain metrics and system health via Prometheus',
    url: 'http://localhost:9091/api/a2a',
    preferredTransport: 'http',
    provider: { organization: 'the network', url: 'https://jejunetwork.org' },
    version: '1.0.0',
    capabilities: { 
      streaming: false, 
      pushNotifications: false, 
      stateTransitionHistory: false 
    },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: [
      { 
        id: 'query-metrics', 
        name: 'Query Metrics', 
        description: 'Execute PromQL query against Prometheus', 
        tags: ['query', 'metrics'], 
        examples: ['Show current TPS', 'Get block production rate', 'Check system health'] 
      },
      { 
        id: 'get-alerts', 
        name: 'Get Alerts', 
        description: 'Get currently firing alerts', 
        tags: ['alerts', 'monitoring'], 
        examples: ['Show active alerts', 'Are there any critical issues?'] 
      },
      { 
        id: 'get-targets', 
        name: 'Get Targets', 
        description: 'Get Prometheus scrape targets and their status', 
        tags: ['targets', 'health'], 
        examples: ['Show scrape targets', 'Which services are being monitored?'] 
      },
      // OIF (Open Intents Framework) metrics
      {
        id: 'oif-stats',
        name: 'OIF Statistics',
        description: 'Get Open Intents Framework statistics (intents, solvers, volume)',
        tags: ['oif', 'intents', 'cross-chain'],
        examples: ['Show OIF stats', 'How many intents today?', 'Cross-chain volume?']
      },
      {
        id: 'oif-solver-health',
        name: 'OIF Solver Health',
        description: 'Get health status of active OIF solvers',
        tags: ['oif', 'solvers', 'health'],
        examples: ['Solver health check', 'Are solvers online?', 'Solver success rates']
      },
      {
        id: 'oif-route-stats',
        name: 'OIF Route Statistics',
        description: 'Get cross-chain route performance metrics',
        tags: ['oif', 'routes', 'performance'],
        examples: ['Route performance', 'Best route for Base to Arbitrum?', 'Route success rates']
      }
    ]
  });
});

app.post('/api/a2a', async (req, res) => {
  // Validate incoming request
  const parseResult = A2ARequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.json({
      jsonrpc: '2.0',
      id: req.body.id,
      error: { code: -32600, message: `Invalid request: ${parseResult.error.message}` }
    });
  }

  const { method, params, id } = parseResult.data;
  
  if (method !== 'message/send') {
    return res.json({ 
      jsonrpc: '2.0', 
      id, 
      error: { code: -32601, message: 'Method not found' } 
    });
  }

  if (!params?.message) {
    return res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Missing params.message' }
    });
  }

  const message = params.message;
  const dataPart = message.parts.find((p) => p.kind === 'data');
  const skillId = dataPart?.data?.skillId;
  const query = dataPart?.data?.query;

  let result: { message: string; data: Record<string, unknown> };

  switch (skillId) {
    case 'query-metrics': {
      if (!query) {
        result = { message: 'Missing PromQL query', data: { error: 'query required' } };
        break;
      }
      
      const response = await fetch(`${prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`);
      if (!response.ok) {
        result = { message: 'Prometheus query failed', data: { error: `HTTP ${response.status}` } };
        break;
      }
      
      const rawData = await response.json();
      const parsed = PrometheusQueryResultSchema.safeParse(rawData);
      if (!parsed.success) {
        result = { message: 'Invalid Prometheus response', data: { error: parsed.error.message } };
        break;
      }
      
      result = { 
        message: `Query results for: ${query}`, 
        data: parsed.data.data ?? { result: [] }
      };
      break;
    }

    case 'get-alerts': {
      const response = await fetch(`${prometheusUrl}/api/v1/alerts`);
      if (!response.ok) {
        result = { message: 'Failed to fetch alerts', data: { error: `HTTP ${response.status}` } };
        break;
      }
      
      const rawData = await response.json();
      const parsed = PrometheusAlertsResponseSchema.safeParse(rawData);
      if (!parsed.success) {
        result = { message: 'Invalid alerts response', data: { error: parsed.error.message } };
        break;
      }
      
      const activeAlerts = parsed.data.data.alerts.filter((a) => a.state === 'firing');
      
      result = { 
        message: `Found ${activeAlerts.length} active alerts`, 
        data: { alerts: activeAlerts } 
      };
      break;
    }

    case 'get-targets': {
      const response = await fetch(`${prometheusUrl}/api/v1/targets`);
      if (!response.ok) {
        result = { message: 'Failed to fetch targets', data: { error: `HTTP ${response.status}` } };
        break;
      }
      
      const rawData = await response.json();
      const parsed = PrometheusTargetsResponseSchema.safeParse(rawData);
      if (!parsed.success) {
        result = { message: 'Invalid targets response', data: { error: parsed.error.message } };
        break;
      }
      
      const targets = parsed.data.data.activeTargets;
      const upCount = targets.filter((t) => t.health === 'up').length;
      
      result = { 
        message: `${upCount}/${targets.length} targets healthy`, 
        data: { targets } 
      };
      break;
    }

    case 'oif-stats': {
      const response = await fetch(`${oifAggregatorUrl}/api/stats`);
      if (!response.ok) {
        result = { message: 'OIF stats unavailable', data: { error: `HTTP ${response.status}` } };
        break;
      }
      
      const rawData = await response.json();
      const parsed = OIFStatsResponseSchema.safeParse(rawData);
      if (!parsed.success) {
        result = { message: 'Invalid OIF stats response', data: { error: parsed.error.message } };
        break;
      }
      
      const stats = parsed.data;
      result = {
        message: `OIF Stats: ${stats.totalIntents} intents, ${stats.activeSolvers} solvers, $${formatVolume(stats.totalVolumeUsd)} volume`,
        data: stats
      };
      break;
    }

    case 'oif-solver-health': {
      const response = await fetch(`${oifAggregatorUrl}/api/solvers?active=true`);
      if (!response.ok) {
        result = { message: 'OIF solvers unavailable', data: { error: `HTTP ${response.status}` } };
        break;
      }
      
      const rawData = await response.json();
      const parsed = z.array(OIFSolverSchema).safeParse(rawData);
      if (!parsed.success) {
        result = { message: 'Invalid solvers response', data: { error: parsed.error.message } };
        break;
      }
      
      const solvers = parsed.data;
      const healthySolvers = solvers.filter((s) => s.successRate >= 95);
      const avgSuccessRate = solvers.length > 0 
        ? solvers.reduce((sum, s) => sum + s.successRate, 0) / solvers.length 
        : 0;
      
      result = {
        message: `${healthySolvers.length}/${solvers.length} solvers healthy, avg success rate: ${avgSuccessRate.toFixed(1)}%`,
        data: {
          totalSolvers: solvers.length,
          healthySolvers: healthySolvers.length,
          avgSuccessRate,
          solvers: solvers.map((s) => ({
            address: s.address,
            name: s.name,
            successRate: s.successRate,
            reputation: s.reputation
          }))
        }
      };
      break;
    }

    case 'oif-route-stats': {
      const response = await fetch(`${oifAggregatorUrl}/api/routes?active=true`);
      if (!response.ok) {
        result = { message: 'OIF routes unavailable', data: { error: `HTTP ${response.status}` } };
        break;
      }
      
      const rawData = await response.json();
      const parsed = z.array(OIFRouteSchema).safeParse(rawData);
      if (!parsed.success) {
        result = { message: 'Invalid routes response', data: { error: parsed.error.message } };
        break;
      }
      
      const routes = parsed.data;
      const totalVolume = routes.reduce((sum, r) => sum + BigInt(r.totalVolume), 0n);
      const avgSuccessRate = routes.length > 0
        ? routes.reduce((sum, r) => sum + r.successRate, 0) / routes.length
        : 0;
      
      result = {
        message: `${routes.length} active routes, ${formatVolume(totalVolume.toString())} ETH volume, ${avgSuccessRate.toFixed(1)}% success`,
        data: {
          totalRoutes: routes.length,
          totalVolume: totalVolume.toString(),
          avgSuccessRate,
          routes: routes.map((r) => ({
            routeId: r.routeId,
            source: r.sourceChainId,
            destination: r.destinationChainId,
            successRate: r.successRate,
            avgTime: r.avgFillTimeSeconds
          }))
        }
      };
      break;
    }

    default:
      result = { message: 'Unknown skill', data: { error: 'invalid skillId' } };
  }

  return res.json({
    jsonrpc: '2.0',
    id,
    result: { 
      role: 'agent', 
      parts: [
        { kind: 'text', text: result.message }, 
        { kind: 'data', data: result.data }
      ], 
      messageId: message.messageId, 
      kind: 'message' 
    }
  });
});

const PORT = 9091;
app.listen(PORT, () => console.log(`📊 Monitoring A2A: http://localhost:${PORT}`));

