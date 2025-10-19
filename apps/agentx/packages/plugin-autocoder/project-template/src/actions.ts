/**
 * Example HelloWorld action
 * This demonstrates the simplest possible action structure
 */
/**
 * Represents an action that responds with a simple hello world message.
 *
 * @typedef {Object} Action
 * @property {string} name - The name of the action
 * @property {string[]} similes - The related similes of the action
 * @property {string} description - Description of the action
 * @property {Function} validate - Validation function for the action
 * @property {Function} handler - The function that handles the action
 * @property {Object[]} examples - Array of examples for the action
 */
// const helloWorldAction: Action = {
//     name: 'HELLO_WORLD',
//     similes: ['GREET', 'SAY_HELLO'],
//     description: 'Responds with a simple hello world message',

//     validate: async (_runtime: IAgentRuntime, _message: Memory, _state: State): Promise<boolean> => {
//       // Always valid
//       return true;
//     },

//     handler: async (
//       _runtime: IAgentRuntime,
//       message: Memory,
//       _state: State,
//       _options: any,
//       callback: HandlerCallback,
//       _responses: Memory[]
//     ): Promise<ActionResult> => {
//       try {
//         logger.info('Handling HELLO_WORLD action');

//         // Simple response content
//         const responseContent: Content = {
//           text: 'hello world!',
//           actions: ['HELLO_WORLD'],
//           source: message.content.source,
//         };

//         // Call back with the hello world message
//         await callback(responseContent);

//         return {
//           text: 'Sent hello world greeting',
//           values: {
//             success: true,
//             greeted: true,
//           },
//           data: {
//             actionName: 'HELLO_WORLD',
//             messageId: message.id,
//             timestamp: Date.now(),
//           },
//           success: true,
//         };
//       } catch (error) {
//         logger.error('Error in HELLO_WORLD action:', error);

//         return {
//           text: 'Failed to send hello world greeting',
//           values: {
//             success: false,
//             error: 'GREETING_FAILED',
//           },
//           data: {
//             actionName: 'HELLO_WORLD',
//             error: error instanceof Error ? error.message : String(error),
//           },
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

export const actions = [
  // actions go here
];
