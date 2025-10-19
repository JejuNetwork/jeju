import TodoPluginComprehensiveE2ETestSuite from './todo-plugin-comprehensive';
import { TodoPluginE2ETestSuite } from './todo-plugin';
import { ReminderDeliveryE2ETestSuite } from './reminder-delivery';

export const testSuites = [
  TodoPluginE2ETestSuite,
  TodoPluginComprehensiveE2ETestSuite,
  ReminderDeliveryE2ETestSuite,
];

export default testSuites;
