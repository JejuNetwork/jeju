/**
 * @fileoverview A2A (Agent-to-Agent) server for network monitoring
 * @module monitoring/server/a2a
 * 
 * Exposes Prometheus metrics and network health status via the A2A protocol,
 * enabling AI agents to programmatically query blockchain network metrics.
 */

import { getNetworkName } from '@jejunetwork/config';

const networkName = getNetworkName();

/*
 * 
 * Features:
 * - Execute PromQL queries against Prometheus
 * - Retrieve active alerts and their status
 * - Query scrape targets health
 * - Get network performance metrics
 * 
 * @example Query metrics from an agent
 * ```typescript
 * const response = await fetch('http://localhost:9091/api/a2a', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     jsonrpc: '2.0',
 *     method: 'message/send',
 *     params: {
 *       message: {
 *         messageId: 'msg-123',
 *         parts: [{
 *           kind: 'data',
 *           data: {
 *             skillId: 'query-metrics',
 *             query: 'rate(http_requests_total[5m])'
 *           }
 *         }]
 *       }
 *     },
 *     id: 1
 *   })
 * });
 * ```
 */

import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:9090';
const OIF_AGGREGATOR_URL = process.env.OIF_AGGREGATOR_URL || 'http://localhost:4010';

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
    provider: { organization: 'the network', url: 'https://jeju.network' },
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
  const { method, params, id } = req.body;
  if (method !== 'message/send') {
    return res.json({ 
      jsonrpc: '2.0', 
      id, 
      error: { code: -32601, message: 'Method not found' } 
    });
  }

  interface MessagePart {
    kind: string;
    data?: { skillId?: string; query?: string };
  }
  interface Message {
    messageId: string;
    parts: MessagePart[];
  }

  const message = params?.message as Message | undefined;
  const dataPart = message?.parts.find((p: MessagePart) => p.kind === 'data');
  const skillId = dataPart?.data?.skillId;
  const query = dataPart?.data?.query;

  let result;
  try {
    switch (skillId) {
      case 'query-metrics': {
        if (!query) {
          result = { message: 'Missing PromQL query', data: { error: 'query required' } };
          break;
        }
        
        const response = await fetch(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        result = { 
          message: `Query results for: ${query}`, 
          data: data.data 
        };
        break;
      }

      case 'get-alerts': {
        interface PrometheusAlert {
          state: string;
          labels: Record<string, string>;
          annotations: Record<string, string>;
        }
        interface AlertsResponse {
          data?: { alerts?: PrometheusAlert[] };
        }
        
        const response = await fetch(`${PROMETHEUS_URL}/api/v1/alerts`);
        const data = await response.json() as AlertsResponse;
        
        const activeAlerts = data.data?.alerts?.filter((a: PrometheusAlert) => a.state === 'firing') || [];
        
        result = { 
          message: `Found ${activeAlerts.length} active alerts`, 
          data: { alerts: activeAlerts } 
        };
        break;
      }

      case 'get-targets': {
        interface PrometheusTarget {
          health: string;
          labels: Record<string, string>;
          lastScrape: string;
        }
        interface TargetsResponse {
          data?: { activeTargets?: PrometheusTarget[] };
        }
        
        const response = await fetch(`${PROMETHEUS_URL}/api/v1/targets`);
        const data = await response.json() as TargetsResponse;
        
        const targets = data.data?.activeTargets || [];
        const upCount = targets.filter((t: PrometheusTarget) => t.health === 'up').length;
        
        result = { 
          message: `${upCount}/${targets.length} targets healthy`, 
          data: { targets } 
        };
        break;
      }

      // OIF Skills
      case 'oif-stats': {
        const response = await fetch(`${OIF_AGGREGATOR_URL}/api/stats`);
        const stats = await response.json();
        
        result = {
          message: `OIF Stats: ${stats.totalIntents} intents, ${stats.activeSolvers} solvers, $${formatVolume(stats.totalVolumeUsd)} volume`,
          data: stats
        };
        break;
      }

      case 'oif-solver-health': {
        const response = await fetch(`${OIF_AGGREGATOR_URL}/api/solvers?active=true`);
        const solvers = await response.json();
        
        const healthySolvers = solvers.filter((s: { successRate: number }) => s.successRate >= 95);
        const avgSuccessRate = solvers.length > 0 
          ? solvers.reduce((sum: number, s: { successRate: number }) => sum + s.successRate, 0) / solvers.length 
          : 0;
        
        result = {
          message: `${healthySolvers.length}/${solvers.length} solvers healthy, avg success rate: ${avgSuccessRate.toFixed(1)}%`,
          data: {
            totalSolvers: solvers.length,
            healthySolvers: healthySolvers.length,
            avgSuccessRate,
            solvers: solvers.map((s: { address: string; name: string; successRate: number; reputation: number }) => ({
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
        const response = await fetch(`${OIF_AGGREGATOR_URL}/api/routes?active=true`);
        const routes = await response.json();
        
        const totalVolume = routes.reduce((sum: bigint, r: { totalVolume: string }) => sum + BigInt(r.totalVolume), 0n);
        const avgSuccessRate = routes.length > 0
          ? routes.reduce((sum: number, r: { successRate: number }) => sum + r.successRate, 0) / routes.length
          : 0;
        
        result = {
          message: `${routes.length} active routes, ${formatVolume(totalVolume.toString())} ETH volume, ${avgSuccessRate.toFixed(1)}% success`,
          data: {
            totalRoutes: routes.length,
            totalVolume: totalVolume.toString(),
            avgSuccessRate,
            routes: routes.map((r: { routeId: string; sourceChainId: number; destinationChainId: number; successRate: number; avgFillTimeSeconds: number }) => ({
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
  } catch (error) {
    result = { 
      message: 'Query failed', 
      data: { error: error instanceof Error ? error.message : 'Unknown error' } 
    };
  }

  res.json({
    jsonrpc: '2.0',
    id,
    result: { 
      role: 'agent', 
      parts: [
        { kind: 'text', text: result.message }, 
        { kind: 'data', data: result.data }
      ], 
      messageId: message?.messageId ?? id, 
      kind: 'message' 
    }
  });
});

const PORT = 9091;
app.listen(PORT, () => console.log(`📊 Monitoring A2A: http://localhost:${PORT}`));

