/**
 * Otto Agent - Main Entry Point
 */

import type { PlatformMessage, CommandResult, Platform } from '../types';
import type { PlatformAdapter } from '../platforms/types';
import { PlatformManager } from '../platforms';
import { commandHandler, CommandHandler } from './commands';
import { getConfig } from '../config';

export class OttoAgent {
  private platformManager: PlatformManager;
  private commandHandler: CommandHandler;
  private aiEnabled: boolean;

  constructor() {
    this.platformManager = new PlatformManager();
    this.commandHandler = commandHandler;
    this.aiEnabled = getConfig().ai.enabled;
  }

  async start(): Promise<void> {
    console.log('[Otto] Starting agent...');

    // Initialize all platforms
    await this.platformManager.initialize();

    // Set up message handlers for each platform
    for (const [platform, adapter] of this.platformManager.getAdapters()) {
      adapter.onMessage(async (message: PlatformMessage) => {
        await this.handleMessage(message, adapter);
      });
      console.log(`[Otto] Listening on ${platform}`);
    }

    const enabledPlatforms = this.platformManager.getEnabledPlatforms();
    console.log(`[Otto] Agent started on ${enabledPlatforms.length} platform(s): ${enabledPlatforms.join(', ')}`);
  }

  async stop(): Promise<void> {
    console.log('[Otto] Stopping agent...');
    await this.platformManager.shutdown();
    console.log('[Otto] Agent stopped');
  }

  private async handleMessage(message: PlatformMessage, adapter: PlatformAdapter): Promise<void> {
    console.log(`[Otto] Received message from ${message.platform}:${message.userId}: ${message.content.slice(0, 50)}...`);

    // Parse command
    const command = this.commandHandler.parseCommand(message);

    let result: CommandResult;

    if (command) {
      // Execute structured command
      result = await this.commandHandler.execute(command);
    } else if (this.aiEnabled) {
      // Use AI for natural language understanding
      result = await this.handleNaturalLanguage(message);
    } else {
      // No AI, provide help
      result = {
        success: false,
        message: `I didn't understand that command.\n\nTry:\n• \`/otto help\` - See available commands\n• \`/otto swap 1 ETH to USDC\` - Swap tokens\n• \`/otto balance\` - Check your balance`,
      };
    }

    // Send response
    await this.sendResponse(adapter, message, result);
  }

  private async handleNaturalLanguage(message: PlatformMessage): Promise<CommandResult> {
    const config = getConfig();
    
    if (!config.ai.modelEndpoint) {
      return {
        success: false,
        message: 'AI is not configured. Please use structured commands like `/otto help`.',
      };
    }

    // Call AI model to understand intent
    const response = await fetch(config.ai.modelEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.ai.modelApiKey ? { 'Authorization': `Bearer ${config.ai.modelApiKey}` } : {}),
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: `You are Otto, a helpful trading assistant. Parse the user's request and determine the appropriate trading action.
            
Available commands:
- swap: swap tokens (e.g., "swap 1 ETH to USDC")
- bridge: bridge tokens across chains (e.g., "bridge 1 ETH from ethereum to base")
- send: send tokens (e.g., "send 0.1 ETH to vitalik.eth")
- balance: check balance
- price: get token price
- launch: launch a new token
- portfolio: show portfolio
- connect: connect wallet
- help: show help

Respond with a JSON object containing:
- command: the command name
- args: array of arguments
- explanation: brief explanation of what you understood

If you can't determine the intent, respond with command: "help".`,
          },
          {
            role: 'user',
            content: message.content,
          },
        ],
        max_tokens: 256,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        message: 'Sorry, I had trouble understanding that. Try `/otto help` for available commands.',
      };
    }

    const aiResponse = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    // Parse AI response
    const content = aiResponse.choices[0]?.message?.content;
    if (!content) {
      return {
        success: false,
        message: 'Sorry, I had trouble understanding that. Try `/otto help` for available commands.',
      };
    }

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: false,
        message: 'Sorry, I had trouble understanding that. Try `/otto help` for available commands.',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      command: string;
      args: string[];
      explanation: string;
    };

    // Create a synthetic parsed command and execute
    const command = this.commandHandler.parseCommand({
      ...message,
      content: `${parsed.command} ${parsed.args.join(' ')}`,
    });

    if (!command) {
      return {
        success: false,
        message: `I understood: "${parsed.explanation}"\n\nBut I couldn't process that request. Try being more specific or use \`/otto help\`.`,
      };
    }

    // Execute the command
    const result = await this.commandHandler.execute(command);

    // Add AI explanation if helpful
    if (result.success && parsed.explanation) {
      result.message = `🤖 ${parsed.explanation}\n\n${result.message}`;
    }

    return result;
  }

  private async sendResponse(
    adapter: PlatformAdapter,
    message: PlatformMessage,
    result: CommandResult
  ): Promise<void> {
    if (result.embed) {
      await adapter.sendEmbed(message.channelId, result.embed, result.buttons);
    } else {
      await adapter.sendMessage(message.channelId, result.message, {
        buttons: result.buttons,
        replyToMessageId: message.messageId,
      });
    }
  }

  // ============================================================================
  // Webhook Handlers
  // ============================================================================

  async handleDiscordWebhook(payload: unknown): Promise<void> {
    const adapter = this.platformManager.getAdapter('discord');
    if (adapter?.handleWebhook) {
      await adapter.handleWebhook(payload);
    }
  }

  async handleTelegramWebhook(payload: unknown): Promise<void> {
    const adapter = this.platformManager.getAdapter('telegram');
    if (adapter?.handleWebhook) {
      await adapter.handleWebhook(payload);
    }
  }

  async handleWhatsAppWebhook(payload: unknown): Promise<void> {
    const adapter = this.platformManager.getAdapter('whatsapp');
    if (adapter?.handleWebhook) {
      await adapter.handleWebhook(payload);
    }
  }

  // ============================================================================
  // Status
  // ============================================================================

  getStatus(): {
    enabled: Platform[];
    ready: Platform[];
  } {
    const enabled = this.platformManager.getEnabledPlatforms();
    const ready = enabled.filter(p => this.platformManager.getAdapter(p)?.isReady());
    return { enabled, ready };
  }
}

export { CommandHandler, commandHandler } from './commands';

