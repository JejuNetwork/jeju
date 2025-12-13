/**
 * Monitoring A2A & MCP Server
 * 
 * Agent-to-agent and Model Context Protocol interfaces for
 * system monitoring and alerting.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// ============================================================================
// Configuration
// ============================================================================

const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Jeju Monitoring',
  description: 'System monitoring, alerting, and health checks for the Jeju network',
  url: '/a2a',
  preferredTransport: 'http',
  provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
  version: '1.0.0',
  capabilities: { streaming: true, pushNotifications: true, stateTransitionHistory: true },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    // Health Check Skills
    { id: 'check-service-health', name: 'Check Service Health', description: 'Check health of a specific service', tags: ['query', 'health'] },
    { id: 'check-all-services', name: 'Check All Services', description: 'Check health of all services', tags: ['query', 'health'] },
    { id: 'get-service-metrics', name: 'Get Service Metrics', description: 'Get metrics for a service', tags: ['query', 'metrics'] },
    
    // Alert Skills
    { id: 'list-alerts', name: 'List Alerts', description: 'List active alerts', tags: ['query', 'alerts'] },
    { id: 'acknowledge-alert', name: 'Acknowledge Alert', description: 'Acknowledge an alert', tags: ['action', 'alert'] },
    { id: 'create-alert-rule', name: 'Create Alert Rule', description: 'Create new alert rule', tags: ['action', 'rule'] },
    { id: 'delete-alert-rule', name: 'Delete Alert Rule', description: 'Delete alert rule', tags: ['action', 'rule'] },
    
    // Chain Monitoring Skills
    { id: 'get-chain-stats', name: 'Get Chain Stats', description: 'Get blockchain statistics', tags: ['query', 'chain'] },
    { id: 'check-rpc-health', name: 'Check RPC Health', description: 'Check RPC endpoint health', tags: ['query', 'rpc'] },
    { id: 'get-gas-prices', name: 'Get Gas Prices', description: 'Get current gas prices', tags: ['query', 'gas'] },
    
    // Contract Monitoring Skills
    { id: 'monitor-contract', name: 'Monitor Contract', description: 'Add contract to monitoring', tags: ['action', 'contract'] },
    { id: 'get-contract-events', name: 'Get Contract Events', description: 'Get recent contract events', tags: ['query', 'events'] },
    { id: 'check-contract-balance', name: 'Check Contract Balance', description: 'Check contract balance', tags: ['query', 'balance'] },
    
    // Infrastructure Skills
    { id: 'get-node-status', name: 'Get Node Status', description: 'Get node status', tags: ['query', 'nodes'] },
    { id: 'get-database-stats', name: 'Get Database Stats', description: 'Get database statistics', tags: ['query', 'database'] },
    { id: 'get-storage-usage', name: 'Get Storage Usage', description: 'Get storage usage', tags: ['query', 'storage'] },
    
    // Log Skills
    { id: 'query-logs', name: 'Query Logs', description: 'Query application logs', tags: ['query', 'logs'] },
    { id: 'get-error-summary', name: 'Get Error Summary', description: 'Get error summary', tags: ['query', 'errors'] },
  ],
};

const MCP_SERVER_INFO = {
  name: 'jeju-monitoring',
  version: '1.0.0',
  description: 'System monitoring, alerting, and health checks',
  capabilities: { resources: true, tools: true, prompts: true },
};

const MCP_RESOURCES = [
  { uri: 'monitoring://services', name: 'Services', description: 'All monitored services', mimeType: 'application/json' },
  { uri: 'monitoring://alerts/active', name: 'Active Alerts', description: 'Currently active alerts', mimeType: 'application/json' },
  { uri: 'monitoring://chain/stats', name: 'Chain Stats', description: 'Blockchain statistics', mimeType: 'application/json' },
  { uri: 'monitoring://infrastructure', name: 'Infrastructure', description: 'Infrastructure status', mimeType: 'application/json' },
  { uri: 'monitoring://dashboard', name: 'Dashboard', description: 'Dashboard summary', mimeType: 'application/json' },
];

const MCP_TOOLS = [
  {
    name: 'check_service',
    description: 'Check health of a specific service',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Service name' },
        includeMetrics: { type: 'boolean', description: 'Include metrics' },
      },
      required: ['service'],
    },
  },
  {
    name: 'query_logs',
    description: 'Query application logs',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Service to query' },
        level: { type: 'string', description: 'Log level filter' },
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
        since: { type: 'string', description: 'Start time (ISO)' },
      },
    },
  },
  {
    name: 'create_alert_rule',
    description: 'Create a new alert rule',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Rule name' },
        condition: { type: 'string', description: 'Alert condition expression' },
        threshold: { type: 'number', description: 'Threshold value' },
        severity: { type: 'string', enum: ['info', 'warning', 'critical'], description: 'Alert severity' },
        channels: { type: 'array', description: 'Notification channels' },
      },
      required: ['name', 'condition', 'threshold', 'severity'],
    },
  },
  {
    name: 'acknowledge_alert',
    description: 'Acknowledge an active alert',
    inputSchema: {
      type: 'object',
      properties: {
        alertId: { type: 'string', description: 'Alert ID' },
        comment: { type: 'string', description: 'Acknowledgement comment' },
      },
      required: ['alertId'],
    },
  },
  {
    name: 'get_metrics',
    description: 'Get metrics for a service or resource',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Metric target (service/contract/node)' },
        metric: { type: 'string', description: 'Metric name' },
        period: { type: 'string', description: 'Time period (1h, 24h, 7d)' },
        aggregation: { type: 'string', enum: ['avg', 'max', 'min', 'sum'], description: 'Aggregation function' },
      },
      required: ['target', 'metric'],
    },
  },
];

const MCP_PROMPTS = [
  {
    name: 'analyze_incident',
    description: 'Analyze a monitoring incident',
    arguments: [
      { name: 'alertId', description: 'Alert ID to analyze', required: true },
    ],
  },
  {
    name: 'summarize_health',
    description: 'Summarize system health status',
    arguments: [
      { name: 'timeframe', description: 'Timeframe to summarize', required: false },
    ],
  },
];

// ============================================================================
// Server Implementation
// ============================================================================

export function createMonitoringA2AServer(): Hono {
  const app = new Hono();
  app.use('/*', cors());

  app.get('/.well-known/agent-card.json', (c) => c.json(AGENT_CARD));

  app.post('/', async (c) => {
    const body = await c.req.json() as { id: unknown; method: string; params?: { message?: { parts?: Array<{ kind: string; data?: Record<string, unknown> }>; messageId?: string } } };
    
    if (body.method !== 'message/send') {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
    }

    const dataPart = body.params?.message?.parts?.find((p) => p.kind === 'data');
    const skillId = dataPart?.data?.skillId as string;
    const result = await executeSkill(skillId, dataPart?.data ?? {});

    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        role: 'agent',
        parts: [{ kind: 'text', text: result.message }, { kind: 'data', data: result.data }],
        messageId: body.params?.message?.messageId,
        kind: 'message',
      },
    });
  });

  return app;
}

async function executeSkill(skillId: string, params: Record<string, unknown>): Promise<{ message: string; data: Record<string, unknown> }> {
  switch (skillId) {
    case 'check-service-health':
      return { message: `Health check for ${params.service}`, data: { status: 'healthy', latency: 50 } };
    case 'check-all-services':
      return { message: 'All services health', data: { services: [], healthy: 0, unhealthy: 0 } };
    case 'list-alerts':
      return { message: 'Active alerts', data: { alerts: [], count: 0 } };
    case 'acknowledge-alert':
      return { message: `Alert ${params.alertId} acknowledged`, data: { success: true } };
    case 'get-chain-stats':
      return { message: 'Chain statistics', data: { blockNumber: 0, tps: 0, gasPrice: '0' } };
    case 'query-logs':
      return { message: 'Log query results', data: { logs: [], total: 0 } };
    case 'get-node-status':
      return { message: 'Node status', data: { nodes: [], healthy: 0 } };
    default:
      return { message: 'Unknown skill', data: { error: 'Skill not found' } };
  }
}

export function createMonitoringMCPServer(): Hono {
  const app = new Hono();
  app.use('/*', cors());

  app.post('/initialize', (c) => c.json({
    protocolVersion: '2024-11-05',
    serverInfo: MCP_SERVER_INFO,
    capabilities: MCP_SERVER_INFO.capabilities,
  }));

  app.post('/resources/list', (c) => c.json({ resources: MCP_RESOURCES }));

  app.post('/resources/read', async (c) => {
    const { uri } = await c.req.json() as { uri: string };
    let contents: unknown = {};

    switch (uri) {
      case 'monitoring://services':
        contents = { services: [
          { name: 'storage', status: 'healthy', uptime: 99.9 },
          { name: 'indexer', status: 'healthy', uptime: 99.8 },
          { name: 'council', status: 'healthy', uptime: 99.9 },
        ]};
        break;
      case 'monitoring://alerts/active':
        contents = { alerts: [] };
        break;
      case 'monitoring://chain/stats':
        contents = { blockNumber: 0, avgBlockTime: 2, tps: 100 };
        break;
      case 'monitoring://infrastructure':
        contents = { nodes: 3, databases: 1, storage: '100GB' };
        break;
      case 'monitoring://dashboard':
        contents = { status: 'healthy', services: 10, alerts: 0, uptime: 99.9 };
        break;
      default:
        return c.json({ error: 'Resource not found' }, 404);
    }

    return c.json({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents) }] });
  });

  app.post('/tools/list', (c) => c.json({ tools: MCP_TOOLS }));

  app.post('/tools/call', async (c) => {
    const { name, arguments: args } = await c.req.json() as { name: string; arguments: Record<string, unknown> };
    let result: unknown = {};

    switch (name) {
      case 'check_service':
        result = { service: args.service, status: 'healthy', latency: 45, uptime: 99.9 };
        break;
      case 'query_logs':
        result = { logs: [], total: 0, query: args.query };
        break;
      case 'create_alert_rule':
        result = { ruleId: crypto.randomUUID(), name: args.name, active: true };
        break;
      case 'acknowledge_alert':
        result = { success: true, alertId: args.alertId };
        break;
      case 'get_metrics':
        result = { target: args.target, metric: args.metric, values: [] };
        break;
      default:
        return c.json({ content: [{ type: 'text', text: 'Tool not found' }], isError: true });
    }

    return c.json({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
  });

  app.post('/prompts/list', (c) => c.json({ prompts: MCP_PROMPTS }));

  app.post('/prompts/get', async (c) => {
    const { name, arguments: args } = await c.req.json() as { name: string; arguments: Record<string, string> };
    let messages: Array<{ role: string; content: { type: string; text: string } }> = [];

    switch (name) {
      case 'analyze_incident':
        messages = [{
          role: 'user',
          content: {
            type: 'text',
            text: `Analyze the monitoring incident with alert ID ${args.alertId}. Provide root cause analysis and recommended actions.`,
          },
        }];
        break;
      case 'summarize_health':
        messages = [{
          role: 'user',
          content: {
            type: 'text',
            text: `Summarize the system health status over the ${args.timeframe ?? 'last 24 hours'}. Include key metrics and any concerning trends.`,
          },
        }];
        break;
      default:
        return c.json({ error: 'Prompt not found' }, 404);
    }

    return c.json({ messages });
  });

  app.get('/', (c) => c.json({
    ...MCP_SERVER_INFO,
    resources: MCP_RESOURCES,
    tools: MCP_TOOLS,
    prompts: MCP_PROMPTS,
  }));

  return app;
}

export function createMonitoringServer(): Hono {
  const app = new Hono();
  app.route('/a2a', createMonitoringA2AServer());
  app.route('/mcp', createMonitoringMCPServer());
  
  app.get('/health', (c) => c.json({
    status: 'healthy',
    service: 'jeju-monitoring',
    version: '1.0.0',
  }));
  
  app.get('/', (c) => c.json({
    name: 'Jeju Monitoring',
    version: '1.0.0',
    endpoints: {
      a2a: '/a2a',
      mcp: '/mcp',
      health: '/health',
      agentCard: '/a2a/.well-known/agent-card.json',
    },
  }));
  
  return app;
}

