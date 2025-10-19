import { describe, it, expect } from 'bun:test';
import AdmZip from 'adm-zip';
import { AgentExportService } from '../../services/AgentExportService';
import { AgentImportService } from '../../services/AgentImportService';
import type { IAgentRuntime, UUID } from '@elizaos/core';
import type { AgentServer } from '../../server';

describe('Agent Portability Integration', () => {
  const testAgentId = 'test-agent-123' as UUID;

  // Mock server instance
  const createMockServer = (agentExists: boolean = true) => {
    const mockDb = {
      select: () => mockDb,
      from: () => mockDb,
      where: () => Promise.resolve(agentExists ? [{ id: testAgentId, name: 'Test Agent' }] : []),
      insert: () => mockDb,
      values: () => Promise.resolve(),
      delete: () => mockDb,
      transaction: async (fn: Function) => {
        const tx = {
          select: () => tx,
          from: () => tx,
          where: () => Promise.resolve([]),
          insert: () => tx,
          values: () => Promise.resolve(),
          delete: () => tx,
        };
        return await fn(tx);
      },
    };

    return {
      db: mockDb,
    } as any;
  };

  describe('Export Service', () => {
    it('should create a valid export ZIP structure', async () => {
      const mockServer = createMockServer(true);
      const mockRuntime = {} as IAgentRuntime;

      // Mock the database to return some data
      let queryCount = 0;
      mockServer.db.where = () => {
        queryCount++;
        const responses = [
          [{ id: testAgentId, name: 'Test Agent', enabled: true }], // agent
          [{ id: 'entity-1', agentId: testAgentId, names: ['Entity'] }], // entities
          [], // worlds
          [], // rooms
          [], // participants
          [{ id: 'mem-1', agentId: testAgentId, content: { text: 'Test' }, embedding: [0.1, 0.2] }], // memories
          [], // relationships
          [], // tasks
          [], // server_agents
        ];
        return Promise.resolve(responses[queryCount - 1] || []);
      };

      const exportService = new AgentExportService(testAgentId, mockRuntime, mockServer);

      try {
        const zipStream = await exportService.exportToZip();

        // Collect stream into buffer
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          zipStream.on('data', (chunk) => chunks.push(chunk));
          zipStream.on('end', () => resolve());
          zipStream.on('error', reject);
        });

        const zipBuffer = Buffer.concat(chunks);

        // Verify ZIP structure
        const zip = new AdmZip(zipBuffer);
        const entries = zip.getEntries();
        const entryNames = entries.map((e) => e.entryName);

        expect(entryNames).toContain('manifest.json');
        expect(entryNames).toContain('database/agent.json');
        expect(entryNames).toContain('database/entities.json');
        expect(entryNames).toContain('database/memories.json');

        // Verify manifest
        const manifestEntry = zip.getEntry('manifest.json');
        const manifest = JSON.parse(zip.readAsText(manifestEntry!));
        expect(manifest.agentId).toBe(testAgentId);
        expect(manifest.tables.length).toBe(9);

        await exportService.cleanup();
      } catch (error) {
        await exportService.cleanup();
        throw error;
      }
    });

    it('should handle non-existent agent gracefully', async () => {
      const mockServer = createMockServer(false);
      const mockRuntime = {} as IAgentRuntime;

      const exportService = new AgentExportService(testAgentId, mockRuntime, mockServer);

      await expect(exportService.exportToZip()).rejects.toThrow(`Agent ${testAgentId} not found`);
      await exportService.cleanup();
    });
  });

  describe('Import Service', () => {
    it('should validate ZIP structure before import', async () => {
      const mockServer = createMockServer();

      // Create invalid ZIP (no manifest)
      const invalidZip = new AdmZip();
      invalidZip.addFile('test.txt', Buffer.from('test'));

      const importService = new AgentImportService(testAgentId, mockServer);

      await expect(importService.importFromZip(invalidZip.toBuffer())).rejects.toThrow(
        'Invalid export: manifest.json not found'
      );

      await importService.cleanup();
    });

    it('should validate manifest version', async () => {
      const mockServer = createMockServer();

      // Create ZIP with invalid version
      const zip = new AdmZip();
      const manifest = {
        version: '99.0.0',
        agentId: 'source-agent',
        agentName: 'Test',
        tables: ['agent'],
        fileCount: 0,
      };

      zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
      zip.addFile('database/agent.json', Buffer.from('[]'));

      const importService = new AgentImportService(testAgentId, mockServer);

      await expect(importService.importFromZip(zip.toBuffer())).rejects.toThrow(
        'Unsupported export version: 99.0.0'
      );

      await importService.cleanup();
    });

    it('should successfully import valid ZIP', async () => {
      const mockServer = createMockServer();

      // Create valid ZIP
      const zip = new AdmZip();
      const manifest = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        agentId: 'source-agent',
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
        elizaVersion: '1.0.0',
      };

      zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));

      // Add all required database files
      const agentData = [
        {
          id: 'source-agent',
          name: 'Test Agent',
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      zip.addFile('database/agent.json', Buffer.from(JSON.stringify(agentData)));

      // Add empty arrays for other tables
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

      const importService = new AgentImportService(testAgentId, mockServer);

      const result = await importService.importFromZip(zip.toBuffer(), {
        overwrite: true,
        validateManifest: true,
      });

      expect(result.success).toBe(true);
      expect(result.agentId).toBe(testAgentId);
      expect(result.agentName).toBe('Test Agent');
      expect(result.tablesImported.length).toBe(9);

      await importService.cleanup();
    });
  });

  describe('Export/Import Cycle', () => {
    it('should maintain data integrity through export/import cycle', async () => {
      // Step 1: Create export data
      const exportZip = new AdmZip();

      const manifest = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        agentId: 'cycle-test-agent',
        agentName: 'Cycle Test Agent',
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
        elizaVersion: '1.0.0',
      };

      exportZip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

      // Add agent with complex data
      const agentData = [
        {
          id: 'cycle-test-agent',
          name: 'Cycle Test Agent',
          enabled: true,
          bio: ['Test bio line 1', 'Test bio line 2'],
          settings: { theme: 'dark', language: 'en' },
          metadata: { version: 1, tags: ['test', 'cycle'] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      exportZip.addFile('database/agent.json', Buffer.from(JSON.stringify(agentData, null, 2)));

      // Add memories with embeddings
      const memories = [
        {
          id: 'memory-1',
          agentId: 'cycle-test-agent',
          content: { text: 'Test memory with embedding' },
          embedding: new Array(768).fill(0.1),
          metadata: { type: 'test' },
          createdAt: Date.now(),
        },
      ];

      exportZip.addFile('database/memories.json', Buffer.from(JSON.stringify(memories, null, 2)));

      // Add other required tables
      const emptyTables = [
        'entities',
        'worlds',
        'rooms',
        'participants',
        'relationships',
        'tasks',
        'server_agents',
      ];
      for (const table of emptyTables) {
        exportZip.addFile(`database/${table}.json`, Buffer.from('[]'));
      }

      // Add a test file
      exportZip.addFile('uploads/test.txt', Buffer.from('test file content'));

      const zipBuffer = exportZip.toBuffer();

      // Step 2: Verify the export
      const verifyZip = new AdmZip(zipBuffer);
      const entries = verifyZip.getEntries();

      expect(entries.length).toBe(11); // manifest + 9 tables + 1 upload

      // Verify manifest
      const manifestEntry = verifyZip.getEntry('manifest.json');
      const readManifest = JSON.parse(verifyZip.readAsText(manifestEntry!));
      expect(readManifest.agentId).toBe('cycle-test-agent');

      // Verify agent data
      const agentEntry = verifyZip.getEntry('database/agent.json');
      const readAgent = JSON.parse(verifyZip.readAsText(agentEntry!));
      expect(readAgent[0].bio).toEqual(['Test bio line 1', 'Test bio line 2']);
      expect(readAgent[0].settings.theme).toBe('dark');

      // Verify memories
      const memoriesEntry = verifyZip.getEntry('database/memories.json');
      const readMemories = JSON.parse(verifyZip.readAsText(memoriesEntry!));
      expect(readMemories[0].embedding.length).toBe(768);
      expect(readMemories[0].content.text).toBe('Test memory with embedding');

      // Verify file
      const fileEntry = verifyZip.getEntry('uploads/test.txt');
      expect(fileEntry?.getData().toString()).toBe('test file content');
    });
  });
});
