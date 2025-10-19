import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { AgentServer } from '../../server';
import { AgentExportService } from '../../services/AgentExportService';
import { AgentImportService } from '../../services/AgentImportService';
import type { IAgentRuntime, UUID, Character } from '@elizaos/core';
import { AgentRuntime } from '@elizaos/core';
import { createDatabaseAdapter } from '@elizaos/plugin-sql';
import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';

describe('Agent Export/Import E2E Test', () => {
  let agentServer: AgentServer;
  let testDbPath: string;
  let sourceAgent: IAgentRuntime;
  let targetAgentId: UUID;

  beforeAll(async () => {
    // Use a test database
    testDbPath = path.join(__dirname, `test-db-export-import-${Date.now()}`);
    process.env.PGLITE_DATA_DIR = testDbPath;

    // Create and initialize agent server
    agentServer = new AgentServer();
    // Use PGLite URL format for testing
    const dbUrl = `pglite://${testDbPath}`;
    await agentServer.initialize(dbUrl);

    // Create a test agent
    const character: Character = {
      id: 'test-char-1' as UUID,
      name: 'Test Export Agent',
      bio: ['An agent for testing export/import'],
      topics: ['testing', 'export', 'import'],
      clients: [],
      plugins: [],
      settings: {
        model: 'gpt-4',
        secrets: {},
      },
      modelProvider: 'openai',
    };

    const db = createDatabaseAdapter({ dataDir: testDbPath }, 'test-agent-export-1' as UUID);

    await db.init();

    sourceAgent = new AgentRuntime({
      agentId: 'test-agent-export-1' as UUID,
      character,
      adapter: db,
      token: process.env.OPENAI_API_KEY || 'test-token',
      serverUrl: 'http://localhost:7777',
    } as any);

    // Register the agent
    await agentServer.registerAgent(sourceAgent);

    // Create some test data
    await db.createMemory({
      id: 'test-memory-1' as UUID,
      agentId: sourceAgent.agentId,
      content: { text: 'This is a test memory for export' },
      roomId: 'test-room-1' as UUID,
      entityId: 'test-entity-1' as UUID,
      unique: true,
      metadata: { type: 'test' },
    });

    targetAgentId = 'test-agent-import-1' as UUID;
  });

  afterAll(async () => {
    // Clean up
    if (agentServer.server) {
      await new Promise<void>((resolve) => {
        agentServer.server.close(() => resolve());
      });
    }

    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.rmSync(testDbPath, { recursive: true, force: true });
    }
  });

  it('should export and import agent data successfully', async () => {
    // Step 1: Export the agent
    const exportService = new AgentExportService(sourceAgent.agentId, sourceAgent, agentServer);

    const zipStream = await exportService.exportToZip();

    // Collect the stream into a buffer
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      zipStream.on('data', (chunk) => chunks.push(chunk));
      zipStream.on('end', () => resolve());
      zipStream.on('error', reject);
    });

    const zipBuffer = Buffer.concat(chunks);
    await exportService.cleanup();

    // Verify the ZIP structure
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    const entryNames = entries.map((e) => e.entryName);

    expect(entryNames).toContain('manifest.json');
    expect(entryNames).toContain('database/agent.json');
    expect(entryNames).toContain('database/memories.json');

    // Step 2: Import to a new agent
    const importService = new AgentImportService(targetAgentId, agentServer);

    const result = await importService.importFromZip(zipBuffer, {
      overwrite: true,
      validateManifest: true,
    });

    await importService.cleanup();

    // Verify import result
    expect(result.success).toBe(true);
    expect(result.agentId).toBe(targetAgentId);
    expect(result.agentName).toBe('Test Export Agent');
    expect(result.tablesImported).toContain('agent');
    expect(result.tablesImported).toContain('memories');

    // Step 3: Verify the imported data
    const targetDb = createDatabaseAdapter({ dataDir: testDbPath }, targetAgentId);

    await targetDb.init();

    // Check if memory was imported
    const memories = await targetDb.getMemories({
      agentId: targetAgentId,
      unique: true,
      count: 10,
    });

    expect(memories.length).toBe(1);
    expect(memories[0].content.text).toBe('This is a test memory for export');
  });

  it('should handle export of non-existent agent', async () => {
    const nonExistentId = 'non-existent-agent' as UUID;
    const exportService = new AgentExportService(nonExistentId, {} as IAgentRuntime, agentServer);

    await expect(exportService.exportToZip()).rejects.toThrow('Agent non-existent-agent not found');
    await exportService.cleanup();
  });

  it('should validate import manifest', async () => {
    const invalidZip = new AdmZip();
    invalidZip.addFile('test.txt', Buffer.from('invalid content'));

    const importService = new AgentImportService(targetAgentId, agentServer);

    await expect(importService.importFromZip(invalidZip.toBuffer())).rejects.toThrow(
      'Invalid export: manifest.json not found'
    );

    await importService.cleanup();
  });
});
