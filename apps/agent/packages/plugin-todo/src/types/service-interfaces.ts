/**
 * Interface definitions for service methods used in tests
 */

export interface TodoReminderService {
  checkTasksForReminders(): Promise<void>;
}

export interface TodoNotificationService {
  sendNotification(message: string, roomId: string): Promise<void>;
}

export interface TodoDailyResetService {
  resetDailyTasks(): Promise<number>;
}

export interface ContentWithText {
  text?: string;
  [key: string]: unknown;
}

export interface ServiceClass {
  serviceType?: string;
  serviceName?: string;
}

export interface MockFunction {
  mock: {
    calls: unknown[][];
  };
}
