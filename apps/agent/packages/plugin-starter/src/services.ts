// import { logger, Service, IAgentRuntime } from "@elizaos/core";

// export class StarterService extends Service {
//     static serviceType = 'starter';
//     capabilityDescription =
//       'This is a starter service which is attached to the agent through the starter plugin.';
//     constructor(protected runtime: IAgentRuntime) {
//       super(runtime);
//     }

//     static async start(runtime: IAgentRuntime) {
//       logger.info(`*** Starting starter service - MODIFIED: ${new Date().toISOString()} ***`);
//       const service = new StarterService(runtime);
//       return service;
//     }

//     static async stop(runtime: IAgentRuntime) {
//       logger.info('*** TESTING DEV MODE - STOP MESSAGE CHANGED! ***');
//       // get the service from the runtime
//       const service = runtime.getService(StarterService.serviceType);
//       if (!service) {
//         throw new Error('Starter service not found');
//       }
//       service.stop();
//     }

//     async stop() {
//       logger.info('*** THIRD CHANGE - TESTING FILE WATCHING! ***');
//     }
//   }

export const Services = [
  // add services here
];

export default Services;
