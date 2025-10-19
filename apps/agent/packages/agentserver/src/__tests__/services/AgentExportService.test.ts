import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentExportService } from '../../services/AgentExportService';
import type { IAgentRuntime, UUID } from '@elizaos/core';
import type { AgentServer } from '../../server';

describe('AgentExportService', () => {
  let mockAgentId: UUID;
  let mockRuntime: IAgentRuntime;
  let mockServerInstance: AgentServer;
  let mockDb: any;

  beforeEach(() => {
    // Setup mocks
    mockAgentId = 'test-agent-id' as UUID;
    mockRuntime = {} as IAgentRuntime;

    // Mock database with query builders
    mockDb = {
      select: () => mockDb,
      from: () => mockDb,
      where: () => Promise.resolve([]),
      execute: () => Promise.resolve(),
    };

    mockServerInstance = {
      db: mockDb,
    } as any;
  });

  describe('constructor', () => {
    it('should create an instance of AgentExportService', () => {
      const exportService = new AgentExportService(mockAgentId, mockRuntime, mockServerInstance);
      expect(exportService).toBeDefined();
      expect(exportService).toBeInstanceOf(AgentExportService);
    });
  });

  describe('exportToZip', () => {
    it('should throw error if agent not found', async () => {
      // Mock database to return empty array (no agent found)
      mockDb.where = () => Promise.resolve([]);

      const exportService = new AgentExportService(mockAgentId, mockRuntime, mockServerInstance);

      await expect(exportService.exportToZip()).rejects.toThrow('Agent test-agent-id not found');
    });
  });

  describe('cleanup', () => {
    it('should handle cleanup when pool is not initialized', async () => {
      const exportService = new AgentExportService(mockAgentId, mockRuntime, mockServerInstance);

      // Should not throw even when pool is not initialized
      await expect(exportService.cleanup()).resolves.toBeUndefined();
    });
  });
});
