import { Action, HandlerCallback, IAgentRuntime, Memory, State, elizaLogger } from '@elizaos/core';
import * as fs from 'fs/promises';
import * as path from 'node:path';

export const publishPluginAction: Action = {
  name: 'PUBLISH_PLUGIN',
  similes: ['publish plugin', 'release plugin', 'deploy plugin', 'push plugin to registry'],

  description:
    'Publish a plugin to npm registry or create a pull request to add it to the Eliza plugin registry',

  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Publish my weather plugin to npm',
          actions: ['PUBLISH_PLUGIN'],
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: "I'll help you publish your weather plugin to npm.",
          actions: ['PUBLISH_PLUGIN'],
        },
      },
      {
        name: '{{agentName}}',
        content: {
          text: 'Successfully published @elizaos/plugin-weather to npm!\n\nVersion: 1.0.0\nRegistry: https://www.npmjs.com/package/@elizaos/plugin-weather\n\nNext steps:\n- Create a PR to add it to the official Eliza plugin registry\n- Update the README with installation instructions',
          actions: ['PUBLISH_PLUGIN'],
        },
      },
    ],
  ],

  async validate(runtime: IAgentRuntime, message: Memory): Promise<boolean> {
    const text = message.content?.text?.toLowerCase() || '';
    return text.includes('publish') && text.includes('plugin');
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<void> => {
    elizaLogger.info('[publishPluginAction] Starting plugin publication');

    // Temporarily disabled while migrating to new registry system
    if (callback) {
      await callback({
        text: '⚠️ Plugin publishing is temporarily unavailable while we migrate to the new registry system.\n\nYou can still publish manually using:\n```bash\nnpm publish --access public\n```\n\nMake sure to:\n1. Run tests with `npm test`\n2. Build with `npm run build`\n3. Login to npm with `npm login`',
        actions: ['PUBLISH_PLUGIN'],
      });
    }
    return;
  },
};

function extractPluginInfo(text: string): string | null {
  // Look for file paths
  const pathMatch = text.match(/[./][\w/-]+/);
  if (pathMatch) {
    return pathMatch[0];
  }

  // Look for plugin names
  const patterns = [/@elizaos\/plugin-[\w-]+/g, /plugin-[\w-]+/g];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }

  // Try to extract from natural language
  const words = text.toLowerCase().split(/\s+/);
  const publishIndex = words.findIndex((w) => w === 'publish');

  if (publishIndex !== -1) {
    // Look for plugin indicator
    for (let i = publishIndex + 1; i < words.length; i++) {
      if (words[i] === 'plugin' && i - 1 >= 0 && words[i - 1] !== 'the') {
        // Get the word before "plugin"
        return `plugin-${words[i - 1]}`;
      } else if (words[i].includes('plugin')) {
        return words[i];
      }
    }
  }

  return null;
}

async function resolvePluginPath(pluginInfo: string): Promise<string | null> {
  // Check if it's already a path
  if (pluginInfo.includes('/') || pluginInfo.includes('.')) {
    
      const absolutePath = path.resolve(pluginInfo);
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        // Check for package.json
        await fs.access(path.join(absolutePath, 'package.json'));
        return absolutePath;
      }
    
  }

  // Check common locations
  const possiblePaths = [
    path.join(process.cwd(), pluginInfo),
    path.join(process.cwd(), 'packages', pluginInfo),
    path.join(process.cwd(), 'cloned-plugins', pluginInfo),
    path.join(process.cwd(), '..', pluginInfo),
  ];

  for (const possiblePath of possiblePaths) {
    try {
      const stat = await fs.stat(possiblePath);
      if (stat.isDirectory()) {
        // Check for package.json
        await fs.access(path.join(possiblePath, 'package.json'));
        return possiblePath;
      }
    } catch {
      // Path doesn't exist or isn't accessible, continue with next path
      continue;
    }
  }

  return null;
}
