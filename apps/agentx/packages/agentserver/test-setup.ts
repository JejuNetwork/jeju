// Mock external dependencies that may not be built yet
import { mock } from 'bun:test';

// Mock @elizaos/core
mock.module('@elizaos/core', () => ({
  logger: {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  },
  validateUuid: (id: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  stringToUuid: (_str: string) => '00000000-0000-0000-0000-000000000000',
  ModelType: {
    TEXT_LARGE: 'text-large',
    TEXT_MEDIUM: 'text-medium',
    TEXT_SMALL: 'text-small',
  },
  ChannelType: {
    DISCORD: 'discord',
    TWITTER: 'twitter',
    TELEGRAM: 'telegram',
  },
}));

// Mock @elizaos/plugin-sql
mock.module('@elizaos/plugin-sql', () => ({
  createDatabaseAdapter: () => ({
    query: async () => ({ rows: [] }),
    init: async () => {},
  }),
  schema: {
    public: {
      Tables: {},
    },
  },
  plugin: {
    name: 'sql',
    description: 'SQL plugin mock',
  },
}));

// Mock other plugins
const createMockPlugin = (name: string) => ({
  name,
  description: `${name} plugin mock`,
  actions: [],
  providers: [],
  evaluators: [],
  services: [],
});

mock.module('@elizaos/plugin-autonomy', () => ({
  autonomyPlugin: createMockPlugin('autonomy'),
}));

mock.module('@elizaos/plugin-bootstrap', () => ({
  bootstrapPlugin: createMockPlugin('bootstrap'),
}));

mock.module('@elizaos/plugin-goals', () => ({
  default: createMockPlugin('goals'),
  GoalsPlugin: createMockPlugin('goals'),
}));

mock.module('@elizaos/plugin-todo', () => ({
  default: createMockPlugin('todo'),
  TodoPlugin: createMockPlugin('todo'),
}));

mock.module('@elizaos/plugin-shell', () => ({
  default: createMockPlugin('shell'),
}));

mock.module('@elizaos/plugin-knowledge', () => ({
  knowledgePlugin: createMockPlugin('knowledge'),
}));

mock.module('@elizaos/plugin-inference', () => ({
  inferencePlugin: createMockPlugin('inference'),
}));

mock.module('@elizaos/plugin-personality', () => ({
  default: createMockPlugin('personality'),
}));

mock.module('@elizaos/plugin-experience', () => ({
  experiencePlugin: createMockPlugin('experience'),
}));

mock.module('@elizaos/plugin-stagehand', () => ({
  stagehandPlugin: createMockPlugin('stagehand'),
}));
