import { describe, it, expect } from 'bun:test';
import AdmZip from 'adm-zip';

describe('Agent Export/Import Demo', () => {
  it('should demonstrate ZIP creation and validation', () => {
    // Create a valid export ZIP structure
    const zip = new AdmZip();

    // 1. Create manifest
    const manifest = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      agentId: 'demo-agent-123',
      agentName: 'Demo Agent',
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
      fileCount: 3,
      elizaVersion: '1.0.0',
    };

    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

    // 2. Add agent data
    const agentData = [
      {
        id: 'demo-agent-123',
        name: 'Demo Agent',
        enabled: true,
        bio: ['A demonstration agent'],
        settings: { theme: 'dark', language: 'en' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    zip.addFile('database/agent.json', Buffer.from(JSON.stringify(agentData, null, 2)));

    // 3. Add memories with embeddings
    const memories = [
      {
        id: 'memory-1',
        agentId: 'demo-agent-123',
        content: { text: 'Hello, I am a demo agent' },
        embedding: new Array(768).fill(0.1), // Mock embedding
        metadata: { type: 'greeting' },
        createdAt: Date.now(),
      },
      {
        id: 'memory-2',
        agentId: 'demo-agent-123',
        content: { text: 'I can help with various tasks' },
        embedding: new Array(768).fill(0.2), // Mock embedding
        metadata: { type: 'capability' },
        createdAt: Date.now(),
      },
    ];

    zip.addFile('database/memories.json', Buffer.from(JSON.stringify(memories, null, 2)));

    // 4. Add other required tables (empty for demo)
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
      zip.addFile(`database/${table}.json`, Buffer.from('[]'));
    }

    // 5. Add some uploaded files
    zip.addFile('uploads/profile.jpg', Buffer.from('fake-image-data'));
    zip.addFile('uploads/documents/guide.pdf', Buffer.from('fake-pdf-data'));
    zip.addFile('uploads/audio/greeting.mp3', Buffer.from('fake-audio-data'));

    // Get the ZIP buffer
    const zipBuffer = zip.toBuffer();

    // Verify the ZIP is valid and contains expected structure
    const verifyZip = new AdmZip(zipBuffer);
    const entries = verifyZip.getEntries();
    const entryNames = entries.map((e) => e.entryName);

    // Assertions
    expect(zipBuffer.length).toBeGreaterThan(0);
    expect(zipBuffer.length).toBeLessThan(10 * 1024); // Should be < 10KB for this demo

    expect(entryNames).toContain('manifest.json');
    expect(entryNames).toContain('database/agent.json');
    expect(entryNames).toContain('database/memories.json');
    expect(entryNames).toContain('uploads/profile.jpg');

    // Verify manifest
    const manifestEntry = verifyZip.getEntry('manifest.json');
    const manifestData = JSON.parse(verifyZip.readAsText(manifestEntry!));
    expect(manifestData.agentId).toBe('demo-agent-123');
    expect(manifestData.fileCount).toBe(3);

    // Verify memories
    const memoriesEntry = verifyZip.getEntry('database/memories.json');
    const memoriesData = JSON.parse(verifyZip.readAsText(memoriesEntry!));
    expect(memoriesData.length).toBe(2);
    expect(memoriesData[0].embedding.length).toBe(768);

    console.log('✅ Export ZIP created successfully');
    console.log(`   - Total size: ${(zipBuffer.length / 1024).toFixed(2)}KB`);
    console.log(`   - Total entries: ${entries.length}`);
    console.log(`   - Database tables: 9`);
    console.log(`   - Uploaded files: 3`);
  });

  it('should handle large datasets efficiently', () => {
    const zip = new AdmZip();

    // Create a large dataset
    const largeMemories = [];
    for (let i = 0; i < 5000; i++) {
      largeMemories.push({
        id: `memory-${i}`,
        agentId: 'large-agent',
        content: { text: `Memory content ${i}` },
        embedding: new Array(768).fill(Math.random()),
        metadata: { index: i },
        createdAt: Date.now() - i * 1000,
      });
    }

    const startTime = Date.now();
    zip.addFile('database/memories.json', Buffer.from(JSON.stringify(largeMemories, null, 2)));
    const compressionTime = Date.now() - startTime;

    const zipBuffer = zip.toBuffer();
    const originalSize = JSON.stringify(largeMemories).length;
    const compressedSize = zipBuffer.length;
    const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(2);

    console.log('✅ Large dataset handling:');
    console.log(`   - 5000 memories with embeddings`);
    console.log(`   - Original size: ${(originalSize / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   - Compressed size: ${(compressedSize / 1024 / 1024).toFixed(2)}MB`);
    console.log(`   - Compression ratio: ${compressionRatio}%`);
    console.log(`   - Compression time: ${compressionTime}ms`);

    expect(compressedSize).toBeLessThan(originalSize);
    expect(compressionTime).toBeLessThan(5000); // Should compress in < 5 seconds
  });
});
