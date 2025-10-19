/**
 * Example HelloWorld action
 * This demonstrates the simplest possible action structure
 */

import {
  Action,
  ActionResult,
  Content,
  HandlerCallback,
  IAgentRuntime,
  logger,
  Memory,
  State,
} from '@elizaos/core';

// /**
//  * Action representing a hello world message.
//  * @typedef {Object} Action
//  * @property {string} name - The name of the action.
//  * @property {string[]} similes - An array of related actions.
//  * @property {string} description - A brief description of the action.
//  * @property {Function} validate - Asynchronous function to validate the action.
//  * @property {Function} handler - Asynchronous function to handle the action and generate a response.
//  * @property {Object[]} examples - An array of example inputs and expected outputs for the action.
//  */
// export const helloWorldAction: Action = {
//     name: 'HELLO_WORLD',
//     similes: ['GREET', 'SAY_HELLO'],
//     description: 'Responds with a simple hello world message',

//     validate: async (
//       _runtime: IAgentRuntime,
//       _message: Memory,
//       _state: State | undefined
//     ): Promise<boolean> => {
//       // Always valid
//       return true;
//     },

//     handler: async (
//       _runtime: IAgentRuntime,
//       message: Memory,
//       _state: State | undefined,
//       _options: any,
//       callback?: HandlerCallback,
//       _responses?: Memory[]
//     ): Promise<ActionResult> => {
//       try {
//         logger.info('Handling HELLO_WORLD action');

//         // Simple response content for callback
//         const responseContent: Content = {
//           text: 'hello world!',
//           actions: ['HELLO_WORLD'],
//           source: message.content.source,
//         };

//         // Call back with the hello world message if callback is provided
//         if (callback) {
//           await callback(responseContent);
//         }

//         // Return ActionResult
//         return {
//           text: 'hello world!',
//           success: true,
//           data: {
//             actions: ['HELLO_WORLD'],
//             source: message.content.source,
//           },
//         };
//       } catch (error) {
//         logger.error('Error in HELLO_WORLD action:', error);
//         return {
//           success: false,
//           error: error instanceof Error ? error : new Error(String(error)),
//         };
//       }
//     },

//     examples: [
//       [
//         {
//           name: '{{name1}}',
//           content: {
//             text: 'Can you say hello?',
//           },
//         },
//         {
//           name: '{{name2}}',
//           content: {
//             text: 'hello world!',
//             actions: ['HELLO_WORLD'],
//           },
//         },
//       ],
//     ],
//   };

export const Actions = [
  // add actions here
];

export default Actions;
