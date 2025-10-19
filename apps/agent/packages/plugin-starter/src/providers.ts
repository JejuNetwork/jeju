import { IAgentRuntime, Memory, Provider, ProviderResult, State } from '@elizaos/core';

/**
 * Example Hello World Provider
 * This demonstrates the simplest possible provider implementation
 */
// const helloWorldProvider: Provider = {
//     name: 'HELLO_WORLD_PROVIDER',
//     description: 'A simple example provider',

//     get: async (
//       _runtime: IAgentRuntime,
//       _message: Memory,
//       _state: State | undefined
//     ): Promise<ProviderResult> => {
//       return {
//         text: 'I am a provider',
//         values: {},
//         data: {},
//       };
//     },
//   };

export const Providers = [
  // add providers here
];

export default Providers;
