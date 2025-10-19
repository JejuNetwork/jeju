import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApiRouter } from '../../api';
import type { IAgentRuntime, UUID } from '@elizaos/core';
import type { AgentServer } from '../../server';
import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';

describe('Agent Portability Integration Tests', () => {
  let app: express.Application;
  let agents: Map<UUID, IAgentRuntime>;
  let mockServerInstance: AgentServer;
  let mockRuntime: IAgentRuntime;
  const testAgentId = 'test-agent-123' as UUID;

  beforeEach(() => {
    // Setup Express app
    app = express();
    agents = new Map();

    // Mock agent runtime
    mockRuntime = {
      agentId: testAgentId,
      character: {
        name: 'Test Agent',
      },
    } as IAgentRuntime;

    agents.set(testAgentId, mockRuntime);

    // Mock server instance with database
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      transaction: vi.fn((callback) =>
        callback({
          insert: vi.fn().mockReturnThis(),
          delete: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
        })
      ),
    };

    // Mock successful agent query
    mockDb.where.mockResolvedValue([
      {
        id: testAgentId,
        name: 'Test Agent',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    mockServerInstance = {
      db: mockDb,
      getAgents: () => agents,
    } as any;

    // Mount API router
    app.use('/api', createApiRouter(agents, mockServerInstance));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Export/Import Cycle', () => {
    it('should export an agent to ZIP file', async () => {
      // Mock fs for file operations
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const response = await request(app)
        .post(`/api/agents/${testAgentId}/export`)
        .expect(200)
        .expect('Content-Type', 'application/zip');

      expect(response.headers['content-disposition']).toMatch(
        /attachment; filename="agent-export-/
      );
      expect(response.headers['x-agent-id']).toBe(testAgentId);
    });

    it('should validate ZIP file before import', async () => {
      // Create a mock ZIP file with valid structure
      const zip = new AdmZip();

      const manifest = {
        version: '1.0.0',
        agentId: 'original-id',
        agentName: 'Test Agent',
        tables: [
          'agent',
          'entities',
          'worlds',
          'rooms',
          'participants',
          'memories',
          'relationships',
          'tasks',
          'server_agents',
        ],
        fileCount: 0,
        exportedAt: new Date().toISOString(),
        elizaVersion: '1.0.0',
      };

      zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

      // Add required database files
      const tables = [
        'agent',
        'entities',
        'worlds',
        'rooms',
        'participants',
        'memories',
        'relationships',
        'tasks',
        'server_agents',
      ];
      for (const table of tables) {
        zip.addFile(`database/${table}.json`, Buffer.from('[]'));
      }

      const zipBuffer = zip.toBuffer();

      const response = await request(app)
        .post(`/api/agents/${testAgentId}/import/validate`)
        .attach('archive', zipBuffer, 'test-export.zip')
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.result.valid).toBe(true);
      expect(response.body.data.result.manifest.agentName).toBe('Test Agent');
    });

    it('should reject import without overwrite flag if agent exists', async () => {
      const zip = new AdmZip();
      zip.addFile('manifest.json', Buffer.from('{}'));
      const zipBuffer = zip.toBuffer();

      const response = await request(app)
        .post(`/api/agents/${testAgentId}/import`)
        .field('overwrite', 'false')
        .attach('archive', zipBuffer, 'test-export.zip')
        .expect(409);

      expect(response.body.error.code).toBe('AGENT_EXISTS');
      expect(response.body.error.message).toContain('Set overwrite=true');
    });

    it('should import agent data with overwrite flag', async () => {
      // Create valid ZIP structure
      const zip = new AdmZip();

      const manifest = {
        version: '1.0.0',
        agentId: 'original-id',
        agentName: 'Imported Agent',
        tables: [
          'agent',
          'entities',
          'worlds',
          'rooms',
          'participants',
          'memories',
          'relationships',
          'tasks',
          'server_agents',
        ],
        fileCount: 0,
        exportedAt: new Date().toISOString(),
        elizaVersion: '1.0.0',
      };

      zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

      // Add agent data
      const agentData = [
        {
          id: 'original-id',
          name: 'Imported Agent',
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      zip.addFile('database/agent.json', Buffer.from(JSON.stringify(agentData, null, 2)));

      // Add empty arrays for other required tables
      const emptyTables = [
        'entities',
        'worlds',
        'rooms',
        'participants',
        'memories',
        'relationships',
        'tasks',
        'server_agents',
      ];
      for (const table of emptyTables) {
        zip.addFile(`database/${table}.json`, Buffer.from('[]'));
      }

      const zipBuffer = zip.toBuffer();

      const response = await request(app)
        .post(`/api/agents/${testAgentId}/import`)
        .field('overwrite', 'true')
        .attach('archive', zipBuffer, 'test-export.zip')
        .expect(200);

      expect(response.body.status).toBe('success');
      expect(response.body.data.result.success).toBe(true);
      expect(response.body.data.result.agentName).toBe('Imported Agent');
      expect(response.body.data.result.tablesImported).toHaveLength(9);
    });

    it('should handle invalid ZIP file gracefully', async () => {
      const invalidZipBuffer = Buffer.from('This is not a valid ZIP file');

      const response = await request(app)
        .post(`/api/agents/${testAgentId}/import`)
        .field('overwrite', 'true')
        .attach('archive', invalidZipBuffer, 'invalid.zip')
        .expect(500);

      expect(response.body.error.code).toBe('IMPORT_FAILED');
    });

    it('should reject oversized ZIP files', async () => {
      // Note: In real implementation, this would be handled by multer middleware
      // This test demonstrates the expected behavior
      const largeBuffer = Buffer.alloc(600 * 1024 * 1024); // 600MB

      // In actual implementation, multer would reject this before reaching our handler
      // Here we're testing the expected response format
      const response = await request(app)
        .post(`/api/agents/${testAgentId}/import`)
        .field('overwrite', 'true')
        .attach('archive', largeBuffer, 'large.zip')
        .expect(413);

      // The actual error would come from multer, but our handler should also validate
      expect(response.body.error).toBeDefined();
    });

    it('should handle missing manifest.json', async () => {
      const zip = new AdmZip();
      // Add some files but no manifest
      zip.addFile('database/agent.json', Buffer.from('[]'));
      const zipBuffer = zip.toBuffer();

      const response = await request(app)
        .post(`/api/agents/${testAgentId}/import`)
        .field('overwrite', 'true')
        .attach('archive', zipBuffer, 'no-manifest.zip')
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_ARCHIVE');
      expect(response.body.error.message).toContain('manifest.json not found');
    });

    it('should validate manifest version', async () => {
      const zip = new AdmZip();

      const manifest = {
        version: '99.0.0', // Unsupported version
        agentId: 'test',
        agentName: 'Test',
        tables: [],
      };

      zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
      const zipBuffer = zip.toBuffer();

      const response = await request(app)
        .post(`/api/agents/${testAgentId}/import`)
        .field('overwrite', 'true')
        .attach('archive', zipBuffer, 'wrong-version.zip')
        .expect(400);

      expect(response.body.error.code).toBe('VERSION_MISMATCH');
      expect(response.body.error.message).toContain('Unsupported export version');
    });

    it('should handle export errors gracefully', async () => {
      // Remove agent to trigger error
      agents.clear();

      const response = await request(app).post(`/api/agents/${testAgentId}/export`).expect(404);

      expect(response.body.error.code).toBe('AGENT_NOT_FOUND');
    });

    it('should validate agent ID format', async () => {
      const response = await request(app).post('/api/agents/invalid-uuid/export').expect(400);

      expect(response.body.error.code).toBe('INVALID_AGENT_ID');
    });

    it('should require ZIP file for import', async () => {
      const response = await request(app)
        .post(`/api/agents/${testAgentId}/import`)
        .field('overwrite', 'true')
        // No file attached
        .expect(400);

      expect(response.body.error.code).toBe('NO_FILE');
      expect(response.body.error.message).toBe('No ZIP file provided');
    });

    it('should support skipValidation option', async () => {
      const zip = new AdmZip();

      // Invalid manifest that would normally fail validation
      const manifest = {
        version: '2.0.0',
        // Missing required fields
      };

      zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
      zip.addFile('database/agent.json', Buffer.from('[{"id": "test", "name": "Test"}]'));

      const zipBuffer = zip.toBuffer();

      const response = await request(app)
        .post(`/api/agents/${testAgentId}/import`)
        .field('overwrite', 'true')
        .field('skipValidation', 'true')
        .attach('archive', zipBuffer, 'skip-validation.zip')
        .expect(200);

      expect(response.body.status).toBe('success');
    });
  });

  describe('Complete Export/Import Flow', () => {
    it('should successfully export and re-import an agent', async () => {
      // Step 1: Export the agent
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['file1.jpg']);
      vi.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => false } as any);

      // Mock complete agent data for export
      const mockDb = (mockServerInstance as any).db;

      // Configure mock to return different data for each query
      let queryCount = 0;
      mockDb.where.mockImplementation(() => {
        queryCount++;
        const responses = [
          // Agent query
          [
            {
              id: testAgentId,
              name: 'Test Agent',
              enabled: true,
              bio: ['A test agent'],
              settings: { theme: 'dark' },
            },
          ],
          // Entities
          [{ id: 'entity-1', agentId: testAgentId, names: ['Entity One'] }],
          // Worlds
          [{ id: 'world-1', agentId: testAgentId, name: 'Test World' }],
          // Rooms
          [{ id: 'room-1', agentId: testAgentId, name: 'Test Room' }],
          // Participants
          [],
          // Memories
          [
            {
              id: 'memory-1',
              agentId: testAgentId,
              content: { text: 'Test memory' },
              embedding: [0.1, 0.2, 0.3],
            },
          ],
          // Relationships
          [],
          // Tasks
          [{ id: 'task-1', agentId: testAgentId, name: 'Test Task' }],
          // Server agents
          [],
        ];
        return Promise.resolve(responses[queryCount - 1] || []);
      });

      // Export request would stream a ZIP file
      // For testing purposes, we'll validate the response headers
      const exportResponse = await request(app)
        .post(`/api/agents/${testAgentId}/export`)
        .expect(200)
        .expect('Content-Type', 'application/zip');

      expect(exportResponse.headers['x-agent-id']).toBe(testAgentId);

      // Step 2: Create a new agent ID for import
      const newAgentId = 'new-agent-456' as UUID;

      // Step 3: Import to new agent
      // For this test, we'll create a mock ZIP that represents what would have been exported
      const zip = new AdmZip();

      const manifest = {
        version: '1.0.0',
        agentId: testAgentId,
        agentName: 'Test Agent',
        tables: [
          'agent',
          'entities',
          'worlds',
          'rooms',
          'participants',
          'memories',
          'relationships',
          'tasks',
          'server_agents',
        ],
        fileCount: 1,
        exportedAt: new Date().toISOString(),
        elizaVersion: '1.0.0',
      };

      zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

      // Add the exported data
      zip.addFile(
        'database/agent.json',
        Buffer.from(
          JSON.stringify(
            [
              {
                id: testAgentId,
                name: 'Test Agent',
                enabled: true,
                bio: ['A test agent'],
                settings: { theme: 'dark' },
              },
            ],
            null,
            2
          )
        )
      );

      zip.addFile(
        'database/entities.json',
        Buffer.from(
          JSON.stringify([{ id: 'entity-1', agentId: testAgentId, names: ['Entity One'] }], null, 2)
        )
      );

      zip.addFile(
        'database/worlds.json',
        Buffer.from(
          JSON.stringify([{ id: 'world-1', agentId: testAgentId, name: 'Test World' }], null, 2)
        )
      );

      zip.addFile(
        'database/rooms.json',
        Buffer.from(
          JSON.stringify([{ id: 'room-1', agentId: testAgentId, name: 'Test Room' }], null, 2)
        )
      );

      zip.addFile('database/participants.json', Buffer.from('[]'));

      zip.addFile(
        'database/memories.json',
        Buffer.from(
          JSON.stringify(
            [
              {
                id: 'memory-1',
                agentId: testAgentId,
                content: { text: 'Test memory' },
                embedding: [0.1, 0.2, 0.3],
              },
            ],
            null,
            2
          )
        )
      );

      zip.addFile('database/relationships.json', Buffer.from('[]'));

      zip.addFile(
        'database/tasks.json',
        Buffer.from(
          JSON.stringify([{ id: 'task-1', agentId: testAgentId, name: 'Test Task' }], null, 2)
        )
      );

      zip.addFile('database/server_agents.json', Buffer.from('[]'));

      // Add a mock uploaded file
      zip.addFile('uploads/file1.jpg', Buffer.from('fake-image-data'));

      const zipBuffer = zip.toBuffer();

      const importResponse = await request(app)
        .post(`/api/agents/${newAgentId}/import`)
        .field('overwrite', 'true')
        .attach('archive', zipBuffer, 'exported-agent.zip')
        .expect(200);

      expect(importResponse.body.status).toBe('success');
      expect(importResponse.body.data.result.success).toBe(true);
      expect(importResponse.body.data.result.agentId).toBe(newAgentId);
      expect(importResponse.body.data.result.agentName).toBe('Test Agent');
      expect(importResponse.body.data.result.tablesImported).toContain('agent');
      expect(importResponse.body.data.result.tablesImported).toContain('memories');
      expect(importResponse.body.data.result.filesImported).toBe(1);
    });
  });
});
