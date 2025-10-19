import type { Plugin } from '@elizaos/core';
import { actions } from './actions';
import { providers } from './providers';
import { services } from './services';
import { tests } from './tests';

const plugin: Plugin = {
  name: 'starter',
  description: 'A starter plugin for Eliza',
  config: {
    EXAMPLE_PLUGIN_VARIABLE: process.env.EXAMPLE_PLUGIN_VARIABLE,
  },
  async init(_config: Record<string, string>) {
    // init code goes here
  },
  services,
  actions,
  providers,
  tests,
};

export default plugin;
