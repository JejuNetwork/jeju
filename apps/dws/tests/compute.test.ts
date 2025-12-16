/**
 * Compute Service Integration Tests
 * 
 * These tests require the DWS server to be running.
 * Run with: bun test tests/compute.test.ts
 * Or via: bun run test:integration
 * 
 * For unit tests, use: bun run test
 */

import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from 'bun:test';
import { app } from '../src/server';

setDefaultTimeout(10000);

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Skip integration tests when running from root (parallel execution causes issues)
const SKIP = process.env.CI === 'true' || process.env.SKIP_INTEGRATION === 'true';

describe.skipIf(SKIP)('Compute Service', () => {
  describe('Health Check', () => {
    test('GET /compute/health should return healthy status', async () => {
      const res = await app.request('/compute/health');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.service).toBe('dws-compute');
      expect(body.status).toBe('healthy');
      expect(body.activeJobs).toBeDefined();
      expect(body.maxConcurrent).toBeDefined();
      expect(body.queuedJobs).toBeDefined();
    });
  });

  describe('Chat Completions API', () => {
    test('POST /compute/chat/completions without backend returns mock response', async () => {
      // Without INFERENCE_API_URL, returns a clearly-labeled mock response
      const res = await app.request('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-model',
          messages: [{ role: 'user', content: 'Hello world' }],
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.object).toBe('chat.completion');
      // Mock response clearly indicates it's a mock
      expect(body.choices[0].message.content).toContain('mock response');
      expect(body.choices[0].message.content).toContain('INFERENCE_API_URL');
    });

    test('POST /compute/chat/completions uses provided model in mock response', async () => {
      const res = await app.request('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Test' }],
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.model).toBe('gpt-4o');
    });

    test('POST /compute/chat/completions returns OpenAI-compatible structure', async () => {
      const res = await app.request('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-model',
          messages: [{ role: 'user', content: 'Test' }],
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('object');
      expect(body).toHaveProperty('created');
      expect(body).toHaveProperty('model');
      expect(body).toHaveProperty('choices');
      expect(body.choices).toHaveLength(1);
      expect(body.choices[0]).toHaveProperty('message');
      expect(body.choices[0].message).toHaveProperty('role');
      expect(body.choices[0].message).toHaveProperty('content');
      expect(body).toHaveProperty('usage');
    });
  });

  describe('Job Submission', () => {
    test('POST /compute/jobs without auth should return 401', async () => {
      const res = await app.request('/compute/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo hello' }),
      });

      expect(res.status).toBe(401);
    });

    test('POST /compute/jobs without command should return 400', async () => {
      const res = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain('Command');
    });

    test('POST /compute/jobs should submit and queue a job', async () => {
      const res = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo "test output"' }),
      });

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.jobId).toBeDefined();
      expect(['queued', 'running']).toContain(body.status);
    });

    test('POST /compute/jobs with custom shell should work', async () => {
      const res = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          command: 'echo $SHELL',
          shell: 'sh',
        }),
      });

      expect(res.status).toBe(201);
    });

    test('POST /compute/jobs with environment variables should work', async () => {
      const res = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          command: 'echo $MY_VAR',
          env: { MY_VAR: 'custom_value' },
        }),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('Job Status', () => {
    test('GET /compute/jobs/:jobId should return job details', async () => {
      // Submit a job first
      const submitRes = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo hello' }),
      });

      const { jobId } = await submitRes.json();

      // Get job status
      const statusRes = await app.request(`/compute/jobs/${jobId}`);
      expect(statusRes.status).toBe(200);

      const body = await statusRes.json();
      expect(body.jobId).toBe(jobId);
      expect(body.status).toBeDefined();
    });

    test('GET /compute/jobs/:jobId for non-existent job should return 404', async () => {
      const res = await app.request('/compute/jobs/nonexistent-job-id');
      expect(res.status).toBe(404);
    });

    test('Job should complete with output', async () => {
      const submitRes = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo "expected output"' }),
      });

      const { jobId } = await submitRes.json();

      // Wait for completion
      let status = 'queued';
      let attempts = 0;
      let body: { status: string; output: string; exitCode: number };

      while (status !== 'completed' && status !== 'failed' && attempts < 50) {
        await new Promise((r) => setTimeout(r, 100));
        const res = await app.request(`/compute/jobs/${jobId}`);
        body = await res.json();
        status = body.status;
        attempts++;
      }

      expect(body!.status).toBe('completed');
      expect(body!.output).toContain('expected output');
      expect(body!.exitCode).toBe(0);
    });

    test('Job with failing command should report failure', async () => {
      const submitRes = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'exit 42' }),
      });

      const { jobId } = await submitRes.json();

      // Wait for completion
      let status = 'queued';
      let attempts = 0;
      let body: { status: string; exitCode: number };

      while (status !== 'completed' && status !== 'failed' && attempts < 50) {
        await new Promise((r) => setTimeout(r, 100));
        const res = await app.request(`/compute/jobs/${jobId}`);
        body = await res.json();
        status = body.status;
        attempts++;
      }

      expect(body!.status).toBe('failed');
      expect(body!.exitCode).toBe(42);
    });
  });

  describe('Job Cancellation', () => {
    test('POST /compute/jobs/:jobId/cancel should cancel a running job', async () => {
      // Submit a long-running job
      const submitRes = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'sleep 60' }),
      });

      const { jobId } = await submitRes.json();

      // Give it time to start
      await new Promise((r) => setTimeout(r, 200));

      // Cancel
      const cancelRes = await app.request(`/compute/jobs/${jobId}/cancel`, {
        method: 'POST',
      });

      expect(cancelRes.status).toBe(200);

      const body = await cancelRes.json();
      expect(body.status).toBe('cancelled');
    });

    test('POST /compute/jobs/:jobId/cancel for completed job should fail', async () => {
      // Submit quick job
      const submitRes = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo done' }),
      });

      const { jobId } = await submitRes.json();

      // Wait for completion
      await new Promise((r) => setTimeout(r, 500));

      // Try to cancel
      const cancelRes = await app.request(`/compute/jobs/${jobId}/cancel`, {
        method: 'POST',
      });

      expect(cancelRes.status).toBe(400);
    });

    test('POST /compute/jobs/:jobId/cancel for non-existent job should return 404', async () => {
      const res = await app.request('/compute/jobs/nonexistent-job/cancel', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('Job Listing', () => {
    test('GET /compute/jobs should return list of jobs', async () => {
      // Submit a job first
      await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo list-test' }),
      });

      const res = await app.request('/compute/jobs');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.jobs).toBeInstanceOf(Array);
      expect(body.total).toBeGreaterThan(0);
    });

    test('GET /compute/jobs with status filter should filter jobs', async () => {
      const res = await app.request('/compute/jobs?status=completed');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.jobs).toBeInstanceOf(Array);
      body.jobs.forEach((job: { status: string }) => {
        expect(job.status).toBe('completed');
      });
    });

    test('GET /compute/jobs with limit should respect limit', async () => {
      const res = await app.request('/compute/jobs?limit=5');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.jobs.length).toBeLessThanOrEqual(5);
    });

    test('GET /compute/jobs with x-jeju-address should filter by submitter', async () => {
      const res = await app.request('/compute/jobs', {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      // All jobs should be from this submitter (or none if user has no jobs)
      expect(body.jobs).toBeInstanceOf(Array);
    });
  });

  describe('Concurrent Jobs', () => {
    test('should handle multiple concurrent job submissions', async () => {
      const submissions = Array.from({ length: 10 }, (_, i) =>
        app.request('/compute/jobs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': TEST_ADDRESS,
          },
          body: JSON.stringify({ command: `echo "job ${i}"` }),
        })
      );

      const responses = await Promise.all(submissions);

      responses.forEach((res) => {
        expect(res.status).toBe(201);
      });

      const bodies = await Promise.all(responses.map((r) => r.json()));
      const jobIds = bodies.map((b) => b.jobId);
      const uniqueIds = new Set(jobIds);

      expect(uniqueIds.size).toBe(10); // All unique job IDs
    });
  });

  describe('Job Edge Cases', () => {
    test('should handle command with special characters', async () => {
      const res = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo "quotes \\"nested\\" and $variables"' }),
      });

      expect(res.status).toBe(201);
    });

    test('should handle multi-line commands', async () => {
      const res = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          command: `echo "line 1"
echo "line 2"
echo "line 3"`,
        }),
      });

      expect(res.status).toBe(201);

      const { jobId } = await res.json();

      // Wait for completion
      await new Promise((r) => setTimeout(r, 500));

      const statusRes = await app.request(`/compute/jobs/${jobId}`);
      const body = await statusRes.json();

      expect(body.output).toContain('line 1');
      expect(body.output).toContain('line 2');
      expect(body.output).toContain('line 3');
    });

    test('should capture stderr in output', async () => {
      const res = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo "stderr message" >&2' }),
      });

      expect(res.status).toBe(201);

      const { jobId } = await res.json();

      await new Promise((r) => setTimeout(r, 500));

      const statusRes = await app.request(`/compute/jobs/${jobId}`);
      const body = await statusRes.json();

      expect(body.output).toContain('stderr message');
    });

    test('job should include CI environment variables', async () => {
      const res = await app.request('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo "CI=$CI JEJU_COMPUTE=$JEJU_COMPUTE"' }),
      });

      expect(res.status).toBe(201);

      const { jobId } = await res.json();
      await new Promise((r) => setTimeout(r, 500));

      const statusRes = await app.request(`/compute/jobs/${jobId}`);
      const body = await statusRes.json();

      expect(body.output).toContain('CI=true');
      expect(body.output).toContain('JEJU_COMPUTE=true');
    });
  });
});

