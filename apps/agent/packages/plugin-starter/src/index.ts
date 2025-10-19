import type { Plugin } from '@elizaos/core';
import { Actions } from './actions';
import { Providers } from './providers';
import { Services } from './services';
import PluginTestSuite from './tests';
import configSchema from './config';

export const plugin: Plugin = {
  name: 'plugin',
  description: 'Plugin for ElizaOS',
  config: configSchema,
  services: Services,
  actions: Actions,
  providers: Providers,
  tests: [PluginTestSuite],
  dependencies: [],
};

export default plugin;
