// export class StarterService extends Service {
//     static serviceType = 'starter';
//     capabilityDescription =
//       'This is a starter service which is attached to the agent through the starter plugin.';

//     constructor(runtime: IAgentRuntime) {
//       super(runtime);
//     }

//     static async start(runtime: IAgentRuntime) {
//       logger.info('*** Starting starter service ***');
//       const service = new StarterService(runtime);
//       return service;
//     }

//     static async stop(runtime: IAgentRuntime) {
//       logger.info('*** Stopping starter service ***');
//       // get the service from the runtime
//       const service = runtime.getService(StarterService.serviceType);
//       if (!service) {
//         throw new Error('Starter service not found');
//       }
//       service.stop();
//     }

//     async stop() {
//       logger.info('*** Stopping starter service instance ***');
//     }
//   }

export const services = [
  // services go here
];
