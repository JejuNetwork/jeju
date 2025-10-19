import { getService, ModelType, type IAgentRuntime } from '@elizaos/core';
import { createDatabaseAdapter } from '@elizaos/plugin-sql';
import { v4 as uuidv4 } from 'uuid';

// Create a test runtime with the necessary configuration
const createTestRuntime = async (): Promise<IAgentRuntime> => {
  const agentId = uuidv4();

  // Create a simple runtime-like object
  const runtime = {
    agentId,
    databaseAdapter: undefined,
    registerDatabaseAdapter: function (adapter: any) {
      this.databaseAdapter = adapter;
    },
    getSetting: function (key: string) {
      // Use PGLite for testing
      if (key === 'POSTGRES_URL') return undefined;
      if (key === 'PGLITE_PATH') return './.test-db';
      if (key === 'FORCE_PGLITE') return 'true';
      return undefined;
    },
    getService: getService,
    registerService: async function (serviceClass: any) {
      console.log('Registering service:', serviceClass.name || serviceClass.constructor.name);
    },
    character: {
      name: 'TestAgent',
      modelProvider: ModelType.GROK,
    },
    services: new Map(),
  } as any;

  return runtime;
};

const testMigration = async () => {
  console.log('🔧 Setting up test migration...');

  try {
    const runtime = await createTestRuntime();
    console.log('Runtime created with agent ID:', runtime.agentId);

    // Create database adapter
    const adapter = await createDatabaseAdapter(
      {
        dataDir: './.test-db',
        forcePglite: true,
      },
      runtime.agentId
    );

    await adapter.init();
    runtime.registerDatabaseAdapter(adapter);
    console.log('Database adapter initialized');

    // Initialize the SQL plugin to trigger migration
    const { plugin: sqlPlugin } = await import('@elizaos/plugin-sql');
    console.log('📦 Initializing SQL plugin...');
    await sqlPlugin.init?.(undefined, runtime);

    // Initialize the forms plugin
    const { default: formsPlugin } = await import('./src/index');
    console.log('📦 Initializing forms plugin...');
    await formsPlugin.init?.(undefined, runtime);

    console.log('✅ Migration test completed successfully');
  } catch (error) {
    console.error('❌ Migration test failed:', error);
    process.exit(1);
  }
};

testMigration();
