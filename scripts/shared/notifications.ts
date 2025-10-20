/**
 * @title Shared Notification Utilities
 * @notice Centralized notification handling for Discord, Telegram, etc.
 */

export interface NotificationConfig {
  discordWebhook?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error' | 'critical';

const EMOJI_MAP: Record<NotificationLevel, string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
  critical: '🚨',
};

export async function sendNotification(
  message: string,
  level: NotificationLevel = 'info',
  config?: NotificationConfig
): Promise<void> {
  const emoji = EMOJI_MAP[level];
  const fullMessage = `${emoji} **Jeju Notification**\n${message}`;
  
  console.log(fullMessage);
  
  if (!config) {
    config = {
      discordWebhook: process.env.DISCORD_WEBHOOK,
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
      telegramChatId: process.env.TELEGRAM_CHAT_ID,
    };
  }
  
  const promises: Promise<void>[] = [];
  
  // Discord
  if (config.discordWebhook) {
    promises.push(sendDiscordNotification(fullMessage, config.discordWebhook));
  }
  
  // Telegram
  if (config.telegramBotToken && config.telegramChatId) {
    promises.push(sendTelegramNotification(fullMessage, config.telegramBotToken, config.telegramChatId));
  }
  
  await Promise.allSettled(promises);
}

async function sendDiscordNotification(message: string, webhookUrl: string): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
    
    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Failed to send Discord notification:', error);
  }
}

async function sendTelegramNotification(
  message: string,
  botToken: string,
  chatId: string
): Promise<void> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Telegram API failed: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Failed to send Telegram notification:', error);
  }
}

/**
 * Send an alert (error or critical level)
 */
export async function sendAlert(message: string, config?: NotificationConfig): Promise<void> {
  return sendNotification(message, 'critical', config);
}

/**
 * Send a success notification
 */
export async function sendSuccess(message: string, config?: NotificationConfig): Promise<void> {
  return sendNotification(message, 'success', config);
}

/**
 * Send a warning
 */
export async function sendWarning(message: string, config?: NotificationConfig): Promise<void> {
  return sendNotification(message, 'warning', config);
}

