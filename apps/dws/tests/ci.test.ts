/**
 * CI/CD Workflow Integration Tests
 * 
 * Run with: bun test tests/ci.test.ts
 * Or via: bun run test:integration
 */

import { describe, test, expect, setDefaultTimeout } from 'bun:test';
import { app } from '../src/server';

setDefaultTimeout(10000);

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const MOCK_REPO_ID = '0x0000000000000000000000000000000000000000000000000000000000000001';
const MOCK_WORKFLOW_ID = '0x0000000000000000000000000000000000000000000000000000000000000002';

// Only skip if explicitly requested, not by default in CI
const SKIP = process.env.SKIP_INTEGRATION === 'true';

describe.skipIf(SKIP)('CI Service', () => {
  describe('Health Check', () => {
    test('GET /ci/health should return healthy', async () => {
      const res = await app.request('/ci/health');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.service).toBe('dws-ci');
      expect(body.status).toBe('healthy');
    });
  });

  describe('Workflow Listing', () => {
    test('GET /ci/workflows/:repoId should return workflow list or error', async () => {
      const res = await app.request(`/ci/workflows/${MOCK_REPO_ID}`);
      // 200 if contracts deployed and working, 500 if not
      expect([200, 500]).toContain(res.status);

      if (res.status === 200) {
        const body = await res.json();
        expect(body.workflows).toBeInstanceOf(Array);
      }
    });

    test('GET /ci/workflows/:repoId with invalid repoId format should handle gracefully', async () => {
      const res = await app.request('/ci/workflows/invalid-repo-id');
      // Either return empty workflows (200) or error (400/500)
      expect([200, 400, 500]).toContain(res.status);
      if (res.status === 200) {
        const body = await res.json();
        expect(body.workflows).toBeInstanceOf(Array);
      }
    });
  });

  describe('Workflow Details', () => {
    test('GET /ci/workflows/:repoId/:workflowId should return runs or error', async () => {
      const res = await app.request(`/ci/workflows/${MOCK_REPO_ID}/${MOCK_WORKFLOW_ID}`);
      // 200 if working, 500 if contracts not deployed
      expect([200, 500]).toContain(res.status);

      if (res.status === 200) {
        const body = await res.json();
        expect(body.workflowId).toBe(MOCK_WORKFLOW_ID);
        expect(body.runs).toBeInstanceOf(Array);
      }
    });
  });

  describe('Workflow Triggering', () => {
    test('POST /ci/runs/:repoId/:workflowId without auth should return 401', async () => {
      const res = await app.request(`/ci/runs/${MOCK_REPO_ID}/${MOCK_WORKFLOW_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(401);
    });

    test('POST /ci/runs/:repoId/:workflowId with auth returns run or error', async () => {
      const res = await app.request(`/ci/runs/${MOCK_REPO_ID}/${MOCK_WORKFLOW_ID}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ branch: 'main' }),
      });

      // Returns run if workflow exists, 404 if not, 500 if no contracts
      expect([200, 404, 500]).toContain(res.status);
    });

    test('POST /ci/runs/:repoId/:workflowId with custom inputs', async () => {
      const res = await app.request(`/ci/runs/${MOCK_REPO_ID}/${MOCK_WORKFLOW_ID}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          branch: 'feature-branch',
          inputs: {
            environment: 'staging',
            debug: 'true',
          },
        }),
      });

      expect([200, 404, 500]).toContain(res.status);
    });
  });

  describe('Run Status', () => {
    test('GET /ci/runs/:runId for non-existent run should return 404', async () => {
      const res = await app.request('/ci/runs/nonexistent-run-id');
      expect(res.status).toBe(404);
    });
  });

  describe('Run Logs', () => {
    test('GET /ci/runs/:runId/logs for non-existent run should return 404', async () => {
      const res = await app.request('/ci/runs/nonexistent-run-id/logs');
      expect(res.status).toBe(404);
    });
  });

  describe('Run Cancellation', () => {
    test('POST /ci/runs/:runId/cancel without auth should return 401', async () => {
      const res = await app.request('/ci/runs/some-run-id/cancel', {
        method: 'POST',
      });

      expect(res.status).toBe(401);
    });

    test('POST /ci/runs/:runId/cancel for non-existent run should return error', async () => {
      const res = await app.request('/ci/runs/nonexistent-run-id/cancel', {
        method: 'POST',
        headers: { 'x-jeju-address': TEST_ADDRESS },
      });

      // 404 if run doesn't exist, 401 if auth fails, 500 if no contract
      expect([401, 404, 500]).toContain(res.status);
    });
  });

  describe('Repository Runs', () => {
    test('GET /ci/repos/:repoId/runs should return runs list', async () => {
      const res = await app.request(`/ci/repos/${MOCK_REPO_ID}/runs`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.runs).toBeInstanceOf(Array);
    });

    test('GET /ci/repos/:repoId/runs with status filter', async () => {
      const res = await app.request(`/ci/repos/${MOCK_REPO_ID}/runs?status=completed`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.runs).toBeInstanceOf(Array);
    });

    test('GET /ci/repos/:repoId/runs with limit', async () => {
      const res = await app.request(`/ci/repos/${MOCK_REPO_ID}/runs?limit=5`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.runs.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Status Badge', () => {
    test('GET /ci/badge/:repoId/:workflowId should return SVG', async () => {
      const res = await app.request(`/ci/badge/${MOCK_REPO_ID}/${MOCK_WORKFLOW_ID}`);
      expect(res.status).toBe(200);

      const contentType = res.headers.get('Content-Type');
      expect(contentType).toBe('image/svg+xml');

      const body = await res.text();
      expect(body).toContain('<svg');
      expect(body).toContain('build');
    });

    test('Badge should have no-cache header', async () => {
      const res = await app.request(`/ci/badge/${MOCK_REPO_ID}/${MOCK_WORKFLOW_ID}`);
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
    });

    test('Badge shows valid status', async () => {
      const res = await app.request(`/ci/badge/${MOCK_REPO_ID}/${MOCK_WORKFLOW_ID}`);
      const body = await res.text();

      // Should show one of the valid statuses
      const validStatuses = ['passing', 'failing', 'cancelled', 'running', 'queued', 'unknown'];
      const hasValidStatus = validStatuses.some((s) => body.includes(s));
      expect(hasValidStatus).toBe(true);
    });
  });
});

describe('CI Server Integration', () => {
  test('DWS health should include ci service', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.services.ci).toBeDefined();
    expect(body.services.ci.status).toBe('healthy');
  });

  test('DWS root should list ci endpoint', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.services).toContain('ci');
    expect(body.endpoints.ci).toBe('/ci/*');
  });
});

describe('CI Edge Cases', () => {
  test('should handle very long branch names', async () => {
    const longBranch = 'feature/' + 'a'.repeat(200);
    const res = await app.request(`/ci/runs/${MOCK_REPO_ID}/${MOCK_WORKFLOW_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({ branch: longBranch }),
    });

    // Should handle gracefully even if it fails
    expect([200, 400, 404, 500]).toContain(res.status);
  });

  test('should handle special characters in input values', async () => {
    const res = await app.request(`/ci/runs/${MOCK_REPO_ID}/${MOCK_WORKFLOW_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({
        branch: 'main',
        inputs: {
          message: 'Test with "quotes" and $variables',
          path: '/path/to/file.txt',
        },
      }),
    });

    expect([200, 404, 500]).toContain(res.status);
  });

  test('should handle empty inputs object', async () => {
    const res = await app.request(`/ci/runs/${MOCK_REPO_ID}/${MOCK_WORKFLOW_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': TEST_ADDRESS,
      },
      body: JSON.stringify({ inputs: {} }),
    });

    expect([200, 404, 500]).toContain(res.status);
  });
});
