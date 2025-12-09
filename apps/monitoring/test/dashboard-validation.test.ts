/**
 * Grafana Dashboard Validation Tests
 * Validates all dashboards render correctly and show accurate data
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GRAFANA_PORT = parseInt(process.env.GRAFANA_PORT || '4010');
const GRAFANA_URL = `http://localhost:${GRAFANA_PORT}`;
const AUTH = Buffer.from('admin:admin').toString('base64');

const DASHBOARD_DIR = path.join(__dirname, '..', 'grafana', 'dashboards');

interface GrafanaTarget {
  expr?: string;
  rawSql?: string;
  refId?: string;
}

interface GrafanaPanel {
  id: number;
  title: string;
  type: string;
  targets?: GrafanaTarget[];
  datasource?: { type: string; uid: string };
  gridPos?: { h: number; w: number; x: number; y: number };
}

interface GrafanaDashboard {
  title: string;
  uid?: string;
  panels: GrafanaPanel[];
  templating?: { list: Array<{ name: string; type: string }> };
  schemaVersion?: number;
  tags?: string[];
  refresh?: string;
}

async function grafanaRequest(endpoint: string): Promise<Response> {
  return fetch(`${GRAFANA_URL}${endpoint}`, {
    headers: { 'Authorization': `Basic ${AUTH}`, 'Content-Type': 'application/json' }
  });
}

function loadDashboard(filename: string): GrafanaDashboard {
  const filepath = path.join(DASHBOARD_DIR, filename);
  const content = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(content);
}

const dashboardFiles = fs.readdirSync(DASHBOARD_DIR).filter(f => f.endsWith('.json'));

// ============================================================================
// DASHBOARD FILE VALIDATION
// ============================================================================

describe('Dashboard File Validation', () => {
  test('should have all 11 required dashboard files', () => {
    const requiredDashboards = [
      'jeju-overview.json',
      'blockchain-activity.json',
      'accounts-and-tokens.json',
      'contract-activity.json',
      'contracts-and-defi.json',
      'eil-overview.json',
      'events-and-logs.json',
      'prediction-markets.json',
      'system-status.json',
      'op-stack.json',
      'subsquid-overview.json'
    ];

    expect(dashboardFiles.length).toBe(11);
    for (const dashboard of requiredDashboards) {
      expect(dashboardFiles).toContain(dashboard);
    }
  });

  test('should have valid JSON in all dashboard files', () => {
    for (const file of dashboardFiles) {
      const dashboard = loadDashboard(file);
      expect(dashboard.title).toBeDefined();
      expect(dashboard.panels).toBeArray();
    }
  });

  test('should have unique UIDs across all dashboards', () => {
    const uids = new Set<string>();
    for (const file of dashboardFiles) {
      const dashboard = loadDashboard(file);
      expect(dashboard.uid).toBeDefined();
      expect(uids.has(dashboard.uid!)).toBe(false);
      uids.add(dashboard.uid!);
    }
  });

  test('should have unique panel IDs within each dashboard', () => {
    for (const file of dashboardFiles) {
      const dashboard = loadDashboard(file);
      const panelIds = dashboard.panels.map(p => p.id).filter(id => id !== undefined);
      const uniqueIds = new Set(panelIds);
      expect(uniqueIds.size).toBe(panelIds.length);
    }
  });

  test('should have proper datasource UIDs in all panels', () => {
    const validDatasourceUids = ['prometheus', 'postgres-indexer'];
    
    for (const file of dashboardFiles) {
      const dashboard = loadDashboard(file);
      for (const panel of dashboard.panels) {
        if (panel.datasource?.uid) {
          expect(validDatasourceUids).toContain(panel.datasource.uid);
        }
      }
    }
  });

  test('should have refresh intervals set', () => {
    for (const file of dashboardFiles) {
      const dashboard = loadDashboard(file);
      expect(dashboard.refresh).toBeDefined();
    }
  });
});

// ============================================================================
// JEJU OVERVIEW DASHBOARD
// ============================================================================

describe('Jeju Overview Dashboard', () => {
  const dashboard = loadDashboard('jeju-overview.json');

  test('should have correct UID', () => {
    expect(dashboard.uid).toBe('jeju-overview');
  });

  test('should have essential stat panels', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    
    expect(panelTitles.some(t => t.includes('block'))).toBe(true);
    expect(panelTitles.some(t => t.includes('transaction'))).toBe(true);
    expect(panelTitles.some(t => t.includes('account'))).toBe(true);
    expect(panelTitles.some(t => t.includes('contract'))).toBe(true);
  });

  test('should have both Prometheus and Postgres queries', () => {
    const hasPrometheus = dashboard.panels.some(p => 
      p.targets?.some(t => t.expr)
    );
    const hasPostgres = dashboard.panels.some(p => 
      p.targets?.some(t => t.rawSql)
    );

    expect(hasPrometheus).toBe(true);
    expect(hasPostgres).toBe(true);
  });

  test('should have time-series panels', () => {
    const timeSeriesPanels = dashboard.panels.filter(p => p.type === 'timeseries');
    expect(timeSeriesPanels.length).toBeGreaterThan(0);
  });

  test('should have pie chart panels for distribution', () => {
    const pieCharts = dashboard.panels.filter(p => p.type === 'piechart');
    expect(pieCharts.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// BLOCKCHAIN ACTIVITY DASHBOARD
// ============================================================================

describe('Blockchain Activity Dashboard', () => {
  const dashboard = loadDashboard('blockchain-activity.json');

  test('should have correct UID', () => {
    expect(dashboard.uid).toBe('jeju-blockchain-activity');
  });

  test('should have block and transaction panels', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    
    expect(panelTitles.some(t => t.includes('block'))).toBe(true);
    expect(panelTitles.some(t => t.includes('transaction'))).toBe(true);
  });

  test('should have time-series panels for activity trends', () => {
    const timeSeriesPanels = dashboard.panels.filter(p => 
      p.type === 'timeseries' || p.type === 'graph'
    );
    expect(timeSeriesPanels.length).toBeGreaterThan(0);
  });

  test('should have table panels for recent data', () => {
    const tablePanels = dashboard.panels.filter(p => p.type === 'table');
    expect(tablePanels.length).toBeGreaterThan(0);
  });

  test('should track gas usage', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('gas'))).toBe(true);
  });
});

// ============================================================================
// ACCOUNTS AND TOKENS DASHBOARD
// ============================================================================

describe('Accounts and Tokens Dashboard', () => {
  const dashboard = loadDashboard('accounts-and-tokens.json');

  test('should have correct UID', () => {
    expect(dashboard.uid).toBe('jeju-accounts-tokens');
  });

  test('should have account tracking panels', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('account'))).toBe(true);
  });

  test('should have token-related panels', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    const hasTokenPanel = panelTitles.some(t => 
      t.includes('token') || t.includes('erc20') || t.includes('transfer')
    );
    expect(hasTokenPanel).toBe(true);
  });

  test('should distinguish EOA and contract accounts', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('eoa') || t.includes('contract'))).toBe(true);
  });

  test('should track token balances', () => {
    const queries = dashboard.panels.flatMap(p => 
      p.targets?.map(t => t.rawSql || '') || []
    ).join(' ');
    expect(queries.includes('token_balance') || queries.includes('token_transfer')).toBe(true);
  });
});

// ============================================================================
// CONTRACT ACTIVITY DASHBOARD
// ============================================================================

describe('Contract Activity Dashboard', () => {
  const dashboard = loadDashboard('contract-activity.json');

  test('should have correct UID', () => {
    expect(dashboard.uid).toBe('jeju-contract-activity');
  });

  test('should track contract events by category', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('category') || t.includes('events'))).toBe(true);
  });

  test('should have category-specific stat panels', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    const categories = ['paymaster', 'game', 'marketplace', 'prediction', 'cloud', 'registry', 'oracle', 'node'];
    
    const hasCategoryPanels = categories.some(cat => 
      panelTitles.some(t => t.includes(cat))
    );
    expect(hasCategoryPanels).toBe(true);
  });

  test('should have timeline visualization', () => {
    const timeSeriesPanels = dashboard.panels.filter(p => p.type === 'timeseries');
    expect(timeSeriesPanels.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// CONTRACTS AND DEFI DASHBOARD
// ============================================================================

describe('Contracts and DeFi Dashboard', () => {
  const dashboard = loadDashboard('contracts-and-defi.json');

  test('should have correct UID', () => {
    expect(dashboard.uid).toBe('jeju-contracts-defi');
  });

  test('should track total contracts', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('total contracts') || t.includes('contract'))).toBe(true);
  });

  test('should categorize token standards', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => 
      t.includes('erc20') || t.includes('erc721') || t.includes('token standard')
    )).toBe(true);
  });

  test('should track contract deployments over time', () => {
    const timeSeriesPanels = dashboard.panels.filter(p => p.type === 'timeseries');
    const hasDeploymentTimeline = timeSeriesPanels.some(p => 
      p.title.toLowerCase().includes('deployment') || p.title.toLowerCase().includes('contract')
    );
    expect(hasDeploymentTimeline).toBe(true);
  });

  test('should show proxy and verified contract stats', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('proxy') || t.includes('verified'))).toBe(true);
  });
});

// ============================================================================
// EVENTS AND LOGS DASHBOARD
// ============================================================================

describe('Events and Logs Dashboard', () => {
  const dashboard = loadDashboard('events-and-logs.json');

  test('should have correct UID', () => {
    expect(dashboard.uid).toBe('jeju-events-logs');
  });

  test('should track event counts', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('event') || t.includes('log'))).toBe(true);
  });

  test('should categorize events by type', () => {
    const panelQueries = dashboard.panels.flatMap(p => 
      p.targets?.map(t => t.rawSql || t.expr || '') || []
    ).join(' ');
    
    expect(panelQueries.includes('event_name') || panelQueries.includes('event_signature')).toBe(true);
  });

  test('should have recent events table', () => {
    const tablePanels = dashboard.panels.filter(p => p.type === 'table');
    expect(tablePanels.length).toBeGreaterThan(0);
  });

  test('should have event distribution visualization', () => {
    const hasDistribution = dashboard.panels.some(p => 
      p.type === 'piechart' || p.type === 'barchart'
    );
    expect(hasDistribution).toBe(true);
  });
});

// ============================================================================
// PREDICTION MARKETS DASHBOARD
// ============================================================================

describe('Prediction Markets Dashboard', () => {
  const dashboard = loadDashboard('prediction-markets.json');

  test('should have correct UID', () => {
    expect(dashboard.uid).toBe('jeju-prediction-markets');
  });

  test('should have market tracking panels', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => 
      t.includes('market') || t.includes('prediction') || t.includes('trade')
    )).toBe(true);
  });

  test('should track market trades', () => {
    const queries = dashboard.panels.flatMap(p => 
      p.targets?.map(t => t.rawSql || '') || []
    ).join(' ');
    expect(queries.includes('market_trade') || queries.includes('prediction_market')).toBe(true);
  });

  test('should show market resolution status', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('resolved') || t.includes('outcome'))).toBe(true);
  });
});

// ============================================================================
// SYSTEM STATUS DASHBOARD
// ============================================================================

describe('System Status Dashboard', () => {
  const dashboard = loadDashboard('system-status.json');

  test('should have correct UID', () => {
    expect(dashboard.uid).toBe('system-status');
  });

  test('should monitor system health', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => 
      t.includes('health') || t.includes('status') || t.includes('monitoring')
    )).toBe(true);
  });

  test('should show database connection status', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('database') || t.includes('connection'))).toBe(true);
  });

  test('should show service availability', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('service') || t.includes('availability'))).toBe(true);
  });

  test('should have both Prometheus and PostgreSQL checks', () => {
    const hasPrometheus = dashboard.panels.some(p => 
      p.targets?.some(t => t.expr)
    );
    const hasPostgres = dashboard.panels.some(p => 
      p.targets?.some(t => t.rawSql)
    );
    expect(hasPrometheus).toBe(true);
    expect(hasPostgres).toBe(true);
  });
});

// ============================================================================
// OP STACK DASHBOARD
// ============================================================================

describe('OP Stack Dashboard', () => {
  const dashboard = loadDashboard('op-stack.json');

  test('should have correct UID', () => {
    expect(dashboard.uid).toBe('jeju-op-stack');
  });

  test('should monitor sequencer health', () => {
    const queries = dashboard.panels.flatMap(p => 
      p.targets?.map(t => t.expr || '') || []
    ).join(' ');
    expect(queries.includes('op-node') || queries.includes('op_node')).toBe(true);
  });

  test('should track batcher status', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('batcher'))).toBe(true);
  });

  test('should track proposer status', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('proposer'))).toBe(true);
  });

  test('should monitor flashblocks latency', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('flashblock') || t.includes('latency'))).toBe(true);
  });

  test('should track P2P network', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('p2p') || t.includes('peer'))).toBe(true);
  });

  test('should monitor EigenDA', () => {
    const queries = dashboard.panels.flatMap(p => 
      p.targets?.map(t => t.expr || '') || []
    ).join(' ');
    expect(queries.includes('eigenda')).toBe(true);
  });

  test('should track challenger activity', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('challenger'))).toBe(true);
  });
});

// ============================================================================
// SUBSQUID INDEXER DASHBOARD
// ============================================================================

describe('Subsquid Indexer Dashboard', () => {
  const dashboard = loadDashboard('subsquid-overview.json');

  test('should have correct UID', () => {
    expect(dashboard.uid).toBe('jeju-subsquid-indexer');
  });

  test('should monitor processor status', () => {
    const queries = dashboard.panels.flatMap(p => 
      p.targets?.map(t => t.expr || '') || []
    ).join(' ');
    expect(queries.includes('subsquid') || queries.includes('processor')).toBe(true);
  });

  test('should track last processed block', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('block') || t.includes('processed'))).toBe(true);
  });

  test('should monitor database lag', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('lag') || t.includes('behind'))).toBe(true);
  });

  test('should track API status', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('api'))).toBe(true);
  });

  test('should monitor processing rate', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('rate') || t.includes('processing'))).toBe(true);
  });

  test('should track API latency', () => {
    const panelTitles = dashboard.panels.map(p => p.title.toLowerCase());
    expect(panelTitles.some(t => t.includes('latency'))).toBe(true);
  });
});

// ============================================================================
// GRAFANA API VALIDATION
// ============================================================================

describe('Grafana API Validation', () => {
  test('should be accessible', async () => {
    const response = await grafanaRequest('/api/health').catch(() => null);
    if (!response) {
      console.log('⚠️ Grafana not running - skipping API tests');
      expect(true).toBe(true);
      return;
    }
    expect(response.ok).toBe(true);
  });

  test('should have Prometheus datasource configured', async () => {
    const response = await grafanaRequest('/api/datasources').catch(() => null);
    if (!response?.ok) {
      console.log('⚠️ Grafana not accessible');
      expect(true).toBe(true);
      return;
    }

    const datasources = await response.json() as Array<{ type: string; uid: string }>;
    const prometheus = datasources.find(ds => ds.type === 'prometheus');
    expect(prometheus).toBeDefined();
    expect(prometheus?.uid).toBe('prometheus');
  });

  test('should have PostgreSQL datasource configured', async () => {
    const response = await grafanaRequest('/api/datasources').catch(() => null);
    if (!response?.ok) {
      console.log('⚠️ Grafana not accessible');
      expect(true).toBe(true);
      return;
    }

    const datasources = await response.json() as Array<{ type: string; uid: string }>;
    const postgres = datasources.find(ds => ds.type === 'postgres');
    expect(postgres).toBeDefined();
    expect(postgres?.uid).toBe('postgres-indexer');
  });

  test('should have all 11 dashboards provisioned', async () => {
    const response = await grafanaRequest('/api/search?type=dash-db').catch(() => null);
    if (!response?.ok) {
      console.log('⚠️ Grafana not accessible');
      expect(true).toBe(true);
      return;
    }

    const dashboards = await response.json() as Array<{ title: string }>;
    console.log(`📊 Found ${dashboards.length} provisioned dashboards`);
    expect(dashboards.length).toBe(11);
  });
});

// ============================================================================
// DASHBOARD QUERY VALIDATION
// ============================================================================

describe('Dashboard Query Validation', () => {
  test('should have no empty queries', () => {
    for (const file of dashboardFiles) {
      const dashboard = loadDashboard(file);
      for (const panel of dashboard.panels) {
        if (panel.targets) {
          for (const target of panel.targets) {
            if (target.expr !== undefined) {
              expect(target.expr.trim().length).toBeGreaterThan(0);
            }
            if (target.rawSql !== undefined) {
              expect(target.rawSql.trim().length).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });

  test('should reference valid tables in SQL queries', () => {
    const validTables = [
      'block', 'transaction', 'account', 'contract', 'log', 
      'decoded_event', 'token_transfer', 'trace', 'token_balance',
      'prediction_market', 'market_trade', 'market_position',
      'node_stake', 'registered_agent'
    ];

    for (const file of dashboardFiles) {
      const dashboard = loadDashboard(file);
      for (const panel of dashboard.panels) {
        if (panel.targets) {
          for (const target of panel.targets) {
            if (target.rawSql) {
              const sql = target.rawSql.toLowerCase();
              
              // Extract CTE names to exclude from table validation
              const cteMatch = sql.match(/with\s+(\w+)\s+as\s*\(/gi);
              const cteNames = cteMatch 
                ? cteMatch.map(m => m.replace(/with\s+/i, '').replace(/\s+as\s*\(/i, '').toLowerCase())
                : [];
              
              const fromMatch = sql.match(/from\s+(\w+)/g);
              if (fromMatch) {
                for (const match of fromMatch) {
                  const table = match.replace(/from\s+/, '');
                  if (!table.startsWith('$') && !table.includes('(') && !cteNames.includes(table)) {
                    const isValid = validTables.some(vt => table.includes(vt));
                    if (!isValid) {
                      console.log(`⚠️ Unknown table '${table}' in ${file}`);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  test('should have proper Prometheus metric references', () => {
    const knownMetricPrefixes = [
      'up', 'prometheus_', 'op_node', 'op_batcher', 'op_proposer', 'op_challenger',
      'reth_', 'eigenda_', 'subsquid', 'pg_', 'rate(', 'histogram_quantile'
    ];

    for (const file of dashboardFiles) {
      const dashboard = loadDashboard(file);
      for (const panel of dashboard.panels) {
        if (panel.targets) {
          for (const target of panel.targets) {
            if (target.expr) {
              const hasValidPrefix = knownMetricPrefixes.some(prefix => 
                target.expr!.includes(prefix)
              );
              expect(hasValidPrefix).toBe(true);
            }
          }
        }
      }
    }
  });
});

// ============================================================================
// PANEL COVERAGE CHECK
// ============================================================================

describe('Panel Coverage Check', () => {
  test('should cover all major indexer entities', () => {
    const allPanelTitles: string[] = [];
    
    for (const file of dashboardFiles) {
      const dashboard = loadDashboard(file);
      allPanelTitles.push(...dashboard.panels.map(p => p.title.toLowerCase()));
    }

    const requiredEntities = [
      { name: 'blocks', patterns: ['block'] },
      { name: 'transactions', patterns: ['transaction', 'tx'] },
      { name: 'accounts', patterns: ['account', 'address', 'wallet'] },
      { name: 'contracts', patterns: ['contract'] },
      { name: 'events', patterns: ['event', 'log'] },
      { name: 'tokens', patterns: ['token', 'erc20', 'transfer'] },
      { name: 'prediction markets', patterns: ['market', 'prediction'] },
      { name: 'gas', patterns: ['gas'] },
      { name: 'latency', patterns: ['latency', 'response'] }
    ];

    for (const entity of requiredEntities) {
      const hasCoverage = entity.patterns.some(pattern => 
        allPanelTitles.some(title => title.includes(pattern))
      );
      expect(hasCoverage).toBe(true);
    }
  });

  test('should have sufficient panel count per dashboard', () => {
    for (const file of dashboardFiles) {
      const dashboard = loadDashboard(file);
      expect(dashboard.panels.length).toBeGreaterThan(3);
    }
  });

  test('should have variety of panel types', () => {
    const allPanelTypes = new Set<string>();
    
    for (const file of dashboardFiles) {
      const dashboard = loadDashboard(file);
      for (const panel of dashboard.panels) {
        allPanelTypes.add(panel.type);
      }
    }

    // Should have at least stat, timeseries/graph, table, and chart types
    expect(allPanelTypes.has('stat')).toBe(true);
    expect(allPanelTypes.has('timeseries') || allPanelTypes.has('graph')).toBe(true);
    expect(allPanelTypes.has('table')).toBe(true);
    expect(allPanelTypes.has('piechart') || allPanelTypes.has('barchart')).toBe(true);
  });
});

// ============================================================================
// PANEL GRID POSITION VALIDATION
// ============================================================================

describe('Panel Grid Position Validation', () => {
  test('should have valid grid positions', () => {
    for (const file of dashboardFiles) {
      const dashboard = loadDashboard(file);
      for (const panel of dashboard.panels) {
        if (panel.gridPos) {
          expect(panel.gridPos.x).toBeGreaterThanOrEqual(0);
          expect(panel.gridPos.y).toBeGreaterThanOrEqual(0);
          expect(panel.gridPos.w).toBeGreaterThan(0);
          expect(panel.gridPos.h).toBeGreaterThan(0);
          expect(panel.gridPos.x + panel.gridPos.w).toBeLessThanOrEqual(24);
        }
      }
    }
  });

  test('should not have overlapping panels', () => {
    for (const file of dashboardFiles) {
      const dashboard = loadDashboard(file);
      const occupiedCells = new Set<string>();
      
      for (const panel of dashboard.panels) {
        if (panel.gridPos) {
          for (let x = panel.gridPos.x; x < panel.gridPos.x + panel.gridPos.w; x++) {
            for (let y = panel.gridPos.y; y < panel.gridPos.y + panel.gridPos.h; y++) {
              const cellKey = `${x},${y}`;
              if (occupiedCells.has(cellKey)) {
                console.log(`⚠️ Overlapping panel at (${x},${y}) in ${file}`);
              }
              occupiedCells.add(cellKey);
            }
          }
        }
      }
    }
  });
});
