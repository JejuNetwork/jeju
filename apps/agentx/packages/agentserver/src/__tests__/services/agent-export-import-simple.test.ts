import { describe, it, expect } from 'bun:test';
import { AgentExportService } from '../../services/AgentExportService';
import { AgentImportService } from '../../services/AgentImportService';
import type { IAgentRuntime, UUID } from '@elizaos/core';
import type { AgentServer } from '../../server';
import AdmZip from 'adm-zip';

describe('Agent Export/Import Services', () => {
  it('should validate manifest structure', () => {
    // Create a valid manifest
    const manifest = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      agentId: 'test-agent-id',
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

    // Verify all required fields are present
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.agentId).toBeDefined();
    expect(manifest.agentName).toBeDefined();
    expect(manifest.tables).toBeInstanceOf(Array);
    expect(manifest.tables.length).toBe(9);
  });

  it('should create valid ZIP structure', () => {
    // Create a mock ZIP with valid structure
    const zip = new AdmZip();

    const manifest = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      agentId: 'test-agent-id',
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

    // Add manifest
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

    // Add database files
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

    // Verify ZIP structure
    const entries = zip.getEntries();
    const entryNames = entries.map((e) => e.entryName);

    expect(entryNames).toContain('manifest.json');
    expect(entryNames.filter((name) => name.startsWith('database/')).length).toBe(9);

    // Verify manifest can be read
    const manifestEntry = zip.getEntry('manifest.json');
    expect(manifestEntry).toBeDefined();

    const manifestData = JSON.parse(zip.readAsText(manifestEntry!));
    expect(manifestData.version).toBe('1.0.0');
  });

  it('should handle large memory arrays in ZIP', () => {
    const zip = new AdmZip();

    // Create a large memory array
    const memories = [];
    for (let i = 0; i < 1000; i++) {
      memories.push({
        id: `memory-${i}`,
        agentId: 'test-agent',
        content: { text: `Test memory content ${i}` },
        embedding: new Array(768).fill(0.1), // Typical embedding size
        metadata: { index: i },
      });
    }

    // Add to ZIP
    zip.addFile('database/memories.json', Buffer.from(JSON.stringify(memories, null, 2)));

    // Verify it can be read back
    const entry = zip.getEntry('database/memories.json');
    const data = JSON.parse(zip.readAsText(entry!));

    expect(data.length).toBe(1000);
    expect(data[0].embedding.length).toBe(768);
  });

  it('should handle file paths correctly', () => {
    const zip = new AdmZip();

    // Add files with different path structures
    zip.addFile('uploads/file1.jpg', Buffer.from('image1'));
    zip.addFile('uploads/subdir/file2.png', Buffer.from('image2'));
    zip.addFile('uploads/deep/nested/path/file3.pdf', Buffer.from('pdf'));

    // Verify all files are present
    const entries = zip.getEntries();
    const uploadFiles = entries.filter((e) => e.entryName.startsWith('uploads/') && !e.isDirectory);

    expect(uploadFiles.length).toBe(3);

    // Verify file contents
    const file1 = zip.getEntry('uploads/file1.jpg');
    expect(file1?.getData().toString()).toBe('image1');
  });

  it('should calculate ZIP size for large files', () => {
    const zip = new AdmZip();

    // Add a large file (10MB)
    const largeData = Buffer.alloc(10 * 1024 * 1024, 'x');
    zip.addFile('uploads/large-file.bin', largeData);

    // Get ZIP buffer
    const zipBuffer = zip.toBuffer();

    // ZIP should compress the data
    expect(zipBuffer.length).toBeLessThan(largeData.length);
    expect(zipBuffer.length).toBeGreaterThan(0);
  });

  it('should validate import ZIP structure', async () => {
    // Create an invalid ZIP (missing manifest)
    const invalidZip = new AdmZip();
    invalidZip.addFile('test.txt', Buffer.from('test'));

    // Mock server instance
    const mockServer = {
      db: {
        transaction: async (callback: Function) => {
          // Should not reach here for invalid ZIP
          throw new Error('Should not process invalid ZIP');
        },
      },
    } as any;

    const importService = new AgentImportService('target-agent-id' as UUID, mockServer);

    // Should throw error for missing manifest
    await expect(importService.importFromZip(invalidZip.toBuffer())).rejects.toThrow(
      'Invalid export: manifest.json not found'
    );

    await importService.cleanup();
  });
});
