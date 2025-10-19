import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentImportService } from '../../services/AgentImportService';
import type { UUID } from '@elizaos/core';
import type { AgentServer } from '../../server';
import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';

// Mock modules
vi.mock('adm-zip');
vi.mock('fs');
vi.mock('path');

// Mock database tables
vi.mock('@elizaos/plugin-sql/schema', () => ({
  agentTable: {},
  memoryTable: {},
  entityTable: {},
  relationshipTable: {},
  worldTable: {},
  roomTable: {},
  participantTable: {},
  taskTable: {},
}));

vi.mock('../../schema', () => ({
  serverAgentsTable: {},
}));

describe('AgentImportService', () => {
  let importService: AgentImportService;
  let mockTargetAgentId: UUID;
  let mockServerInstance: AgentServer;
  let mockDb: any;
  let mockTx: any;
  let mockZip: any;

  beforeEach(() => {
    // Setup mocks
    mockTargetAgentId = 'target-agent-id' as UUID;

    // Mock transaction
    mockTx = {
      insert: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
    };

    // Mock database
    mockDb = {
      transaction: vi.fn((callback) => callback(mockTx)),
    };

    mockServerInstance = {
      db: mockDb,
    } as any;

    // Mock AdmZip
    mockZip = {
      getEntry: vi.fn(),
      readAsText: vi.fn(),
      getEntries: vi.fn().mockReturnValue([]),
    };

    (AdmZip as any).mockImplementation(() => mockZip);

    // Mock fs
    (fs.existsSync as any).mockReturnValue(false);
    (fs.mkdirSync as any).mockReturnValue(undefined);
    (fs.writeFileSync as any).mockReturnValue(undefined);
    (fs.rmSync as any).mockReturnValue(undefined);

    // Mock path
    (path.join as any).mockImplementation((...args: string[]) => args.join('/'));
    (path.dirname as any).mockImplementation((p: string) => p.substring(0, p.lastIndexOf('/')));

    importService = new AgentImportService(mockTargetAgentId, mockServerInstance);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('importFromZip', () => {
    it('should successfully import agent data from valid ZIP', async () => {
      // Setup valid manifest
      const manifest = {
        version: '1.0.0',
        agentId: 'original-agent-id',
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
        fileCount: 2,
        exportedAt: new Date().toISOString(),
        elizaVersion: '1.0.0',
      };

      const mockAgent = {
        id: 'original-agent-id',
        name: 'Test Agent',
        enabled: true,
      };

      const mockMemories = [
        {
          id: 'memory-1',
          agentId: 'original-agent-id',
          content: { text: 'Test memory' },
          embedding: [0.1, 0.2, 0.3],
        },
      ];

      // Mock ZIP entries
      mockZip.getEntry.mockImplementation((path: string) => {
        const entries: Record<string, boolean> = {
          'manifest.json': true,
          'database/agent.json': true,
          'database/entities.json': true,
          'database/worlds.json': true,
          'database/rooms.json': true,
          'database/participants.json': true,
          'database/memories.json': true,
          'database/relationships.json': true,
          'database/tasks.json': true,
          'database/server_agents.json': true,
        };
        return entries[path] ? {} : null;
      });

      mockZip.readAsText.mockImplementation((entry: any) => {
        const path = mockZip.getEntry.mock.calls[mockZip.getEntry.mock.calls.length - 1][0];
        const data: Record<string, string> = {
          'manifest.json': JSON.stringify(manifest),
          'database/agent.json': JSON.stringify([mockAgent]),
          'database/entities.json': JSON.stringify([]),
          'database/worlds.json': JSON.stringify([]),
          'database/rooms.json': JSON.stringify([]),
          'database/participants.json': JSON.stringify([]),
          'database/memories.json': JSON.stringify(mockMemories),
          'database/relationships.json': JSON.stringify([]),
          'database/tasks.json': JSON.stringify([]),
          'database/server_agents.json': JSON.stringify([]),
        };
        return data[path] || '[]';
      });

      const zipBuffer = Buffer.from('mock-zip-data');
      const result = await importService.importFromZip(zipBuffer, { overwrite: true });

      expect(result).toEqual({
        success: true,
        agentId: mockTargetAgentId,
        agentName: 'Test Agent',
        tablesImported: [
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
        filesImported: 0,
        errors: [],
      });

      expect(mockTx.delete).toHaveBeenCalled();
      expect(mockTx.insert).toHaveBeenCalled();
    });

    it('should reject ZIP files that are too large', async () => {
      const largeBuffer = Buffer.alloc(600 * 1024 * 1024); // 600MB

      await expect(importService.importFromZip(largeBuffer)).rejects.toThrow('ZIP file too large');
    });

    it('should validate manifest version', async () => {
      const manifest = {
        version: '2.0.0', // Unsupported version
        agentId: 'test',
        agentName: 'Test',
        tables: [],
      };

      mockZip.getEntry.mockReturnValue({});
      mockZip.readAsText.mockReturnValue(JSON.stringify(manifest));

      const zipBuffer = Buffer.from('mock-zip-data');

      await expect(importService.importFromZip(zipBuffer)).rejects.toThrow(
        'Unsupported export version: 2.0.0'
      );
    });

    it('should validate required manifest fields', async () => {
      const manifest = {
        version: '1.0.0',
        // Missing required fields
      };

      mockZip.getEntry.mockReturnValue({});
      mockZip.readAsText.mockReturnValue(JSON.stringify(manifest));

      const zipBuffer = Buffer.from('mock-zip-data');

      await expect(importService.importFromZip(zipBuffer)).rejects.toThrow(
        'Invalid manifest: missing required fields'
      );
    });

    it('should check for missing expected tables', async () => {
      const manifest = {
        version: '1.0.0',
        agentId: 'test',
        agentName: 'Test',
        tables: ['agent'], // Missing other required tables
      };

      mockZip.getEntry.mockImplementation((path: string) => {
        return path === 'manifest.json' ? {} : null;
      });
      mockZip.readAsText.mockReturnValue(JSON.stringify(manifest));

      const zipBuffer = Buffer.from('mock-zip-data');

      await expect(importService.importFromZip(zipBuffer)).rejects.toThrow(
        'Missing expected table in export: entities'
      );
    });

    it('should handle memories with vector embeddings', async () => {
      const manifest = {
        version: '1.0.0',
        agentId: 'test',
        agentName: 'Test',
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
      };

      const mockMemories = [
        {
          id: 'memory-1',
          agentId: 'original-id',
          content: { text: 'Test' },
          embedding: [0.1, 0.2, 0.3], // Array format
        },
      ];

      mockZip.getEntry.mockReturnValue({});
      mockZip.readAsText.mockImplementation(() => {
        const path = mockZip.getEntry.mock.calls[mockZip.getEntry.mock.calls.length - 1][0];
        if (path === 'manifest.json') return JSON.stringify(manifest);
        if (path === 'database/memories.json') return JSON.stringify(mockMemories);
        if (path === 'database/agent.json') return JSON.stringify([{ id: 'test', name: 'Test' }]);
        return '[]';
      });

      const zipBuffer = Buffer.from('mock-zip-data');
      await importService.importFromZip(zipBuffer, { overwrite: true });

      // Check that memories were inserted with proper embedding conversion
      const memoriesInsertCall = mockTx.insert.mock.calls.find(
        (call: any[]) => call[0] === undefined // Since we're mocking, the table object is undefined
      );
      expect(memoriesInsertCall).toBeDefined();
    });

    it('should extract uploaded files', async () => {
      const manifest = {
        version: '1.0.0',
        agentId: 'test',
        agentName: 'Test',
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
        fileCount: 2,
      };

      mockZip.getEntry.mockReturnValue({});
      mockZip.readAsText.mockImplementation(() => {
        const path = mockZip.getEntry.mock.calls[mockZip.getEntry.mock.calls.length - 1][0];
        if (path === 'manifest.json') return JSON.stringify(manifest);
        if (path === 'database/agent.json') return JSON.stringify([{ id: 'test', name: 'Test' }]);
        return '[]';
      });

      // Mock file entries
      mockZip.getEntries.mockReturnValue([
        {
          entryName: 'uploads/file1.jpg',
          isDirectory: false,
          getData: () => Buffer.from('file1-data'),
        },
        {
          entryName: 'uploads/subdir/file2.png',
          isDirectory: false,
          getData: () => Buffer.from('file2-data'),
        },
        {
          entryName: 'uploads/subdir/',
          isDirectory: true,
        },
      ]);

      const zipBuffer = Buffer.from('mock-zip-data');
      const result = await importService.importFromZip(zipBuffer, { overwrite: true });

      expect(result.filesImported).toBe(2);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('should clear existing upload directory when overwriting', async () => {
      (fs.existsSync as any).mockReturnValue(true);

      const manifest = {
        version: '1.0.0',
        agentId: 'test',
        agentName: 'Test',
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
      };

      mockZip.getEntry.mockReturnValue({});
      mockZip.readAsText.mockImplementation(() => {
        const path = mockZip.getEntry.mock.calls[mockZip.getEntry.mock.calls.length - 1][0];
        if (path === 'manifest.json') return JSON.stringify(manifest);
        if (path === 'database/agent.json') return JSON.stringify([{ id: 'test', name: 'Test' }]);
        return '[]';
      });

      const zipBuffer = Buffer.from('mock-zip-data');
      await importService.importFromZip(zipBuffer, { overwrite: true });

      expect(fs.rmSync).toHaveBeenCalledWith(expect.stringContaining(mockTargetAgentId), {
        recursive: true,
        force: true,
      });
    });

    it('should skip manifest validation when validateManifest is false', async () => {
      const manifest = {
        version: '2.0.0', // Invalid version
        agentId: 'test',
        agentName: 'Test',
        tables: [],
      };

      mockZip.getEntry.mockReturnValue({});
      mockZip.readAsText.mockImplementation(() => {
        const path = mockZip.getEntry.mock.calls[mockZip.getEntry.mock.calls.length - 1][0];
        if (path === 'manifest.json') return JSON.stringify(manifest);
        if (path === 'database/agent.json') return JSON.stringify([{ id: 'test', name: 'Test' }]);
        return '[]';
      });

      const zipBuffer = Buffer.from('mock-zip-data');
      const result = await importService.importFromZip(zipBuffer, {
        overwrite: true,
        validateManifest: false,
      });

      expect(result.success).toBe(true);
    });

    it('should handle transaction rollback on error', async () => {
      const manifest = {
        version: '1.0.0',
        agentId: 'test',
        agentName: 'Test',
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
      };

      mockZip.getEntry.mockReturnValue({});
      mockZip.readAsText.mockImplementation(() => {
        const path = mockZip.getEntry.mock.calls[mockZip.getEntry.mock.calls.length - 1][0];
        if (path === 'manifest.json') return JSON.stringify(manifest);
        return '[]';
      });

      // Make transaction throw error
      mockDb.transaction.mockImplementation(async (callback: Function) => {
        await callback(mockTx);
        throw new Error('Transaction failed');
      });

      const zipBuffer = Buffer.from('mock-zip-data');

      await expect(importService.importFromZip(zipBuffer, { overwrite: true })).rejects.toThrow(
        'Transaction failed'
      );
    });
  });

  describe('cleanup', () => {
    it('should close database pool on cleanup', async () => {
      const mockPool = {
        end: vi.fn().mockResolvedValue(undefined),
      };
      (importService as any).pool = mockPool;

      await importService.cleanup();

      expect(mockPool.end).toHaveBeenCalled();
    });
  });
});
