/**
 * Discord Platform Adapter
 */

import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, type Message, type Interaction, type TextChannel, type DMChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type APIEmbed, type MessageCreateOptions } from 'discord.js';
import type { PlatformAdapter, MessageHandler, SendMessageOptions, PlatformUserInfo, PlatformChannelInfo } from './types';
import type { PlatformMessage, MessageEmbed, MessageButton } from '../types';
import { OTTO_COMMANDS } from '../config';

export class DiscordAdapter implements PlatformAdapter {
  readonly platform = 'discord' as const;
  
  private client: Client;
  private rest: REST;
  private token: string;
  private applicationId: string;
  private publicKey: string;
  private messageHandler: MessageHandler | null = null;
  private ready = false;

  constructor(token: string, applicationId: string, publicKey?: string) {
    this.token = token;
    this.applicationId = applicationId;
    this.publicKey = publicKey ?? '';
    
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    
    this.rest = new REST({ version: '10' }).setToken(token);
    
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('ready', () => {
      console.log(`[Discord] Logged in as ${this.client.user?.tag}`);
      this.ready = true;
    });

    this.client.on('messageCreate', async (message: Message) => {
      if (message.author.bot) return;
      
      // Check if message mentions the bot or starts with /otto
      const isMentioned = message.mentions.has(this.client.user?.id ?? '');
      const isCommand = message.content.toLowerCase().startsWith('/otto') || 
                        message.content.toLowerCase().startsWith('otto ');
      
      if (!isMentioned && !isCommand) return;
      
      const platformMessage = this.convertMessage(message);
      
      if (this.messageHandler) {
        await this.messageHandler(platformMessage);
      }
    });

    this.client.on('interactionCreate', async (interaction: Interaction) => {
      if (!interaction.isChatInputCommand()) return;
      
      if (interaction.commandName === 'otto') {
        const subcommand = interaction.options.getSubcommand(false);
        const args = this.extractSlashCommandArgs(interaction);
        
        const platformMessage: PlatformMessage = {
          platform: 'discord',
          messageId: interaction.id,
          channelId: interaction.channelId,
          userId: interaction.user.id,
          content: `/otto ${subcommand ?? ''} ${args}`.trim(),
          timestamp: Date.now(),
          isCommand: true,
        };
        
        // Defer reply for long-running commands
        await interaction.deferReply();
        
        if (this.messageHandler) {
          await this.messageHandler(platformMessage);
        }
      }
    });

    this.client.on('error', (error: Error) => {
      console.error('[Discord] Client error:', error);
    });
  }

  private convertMessage(message: Message): PlatformMessage {
    // Remove bot mention and /otto prefix
    let content = message.content;
    const mentionPattern = new RegExp(`<@!?${this.client.user?.id}>`, 'g');
    content = content.replace(mentionPattern, '').trim();
    content = content.replace(/^\/otto\s*/i, '').replace(/^otto\s*/i, '').trim();
    
    return {
      platform: 'discord',
      messageId: message.id,
      channelId: message.channelId,
      userId: message.author.id,
      content,
      timestamp: message.createdTimestamp,
      isCommand: true,
      replyToId: message.reference?.messageId,
      attachments: message.attachments.map(a => ({
        type: a.contentType?.startsWith('image/') ? 'image' : 'file',
        url: a.url,
        name: a.name ?? undefined,
        size: a.size,
      })),
    };
  }

  private extractSlashCommandArgs(interaction: Interaction): string {
    if (!interaction.isChatInputCommand()) return '';
    
    const args: string[] = [];
    for (const option of interaction.options.data) {
      if (option.value !== undefined) {
        args.push(String(option.value));
      }
      if (option.options) {
        for (const subOption of option.options) {
          if (subOption.value !== undefined) {
            args.push(String(subOption.value));
          }
        }
      }
    }
    return args.join(' ');
  }

  async initialize(): Promise<void> {
    console.log('[Discord] Initializing...');
    await this.client.login(this.token);
    await this.registerCommands();
  }

  async shutdown(): Promise<void> {
    console.log('[Discord] Shutting down...');
    this.ready = false;
    await this.client.destroy();
  }

  isReady(): boolean {
    return this.ready && this.client.isReady();
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async sendMessage(channelId: string, content: string, options?: SendMessageOptions): Promise<string> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !this.isTextChannel(channel)) {
      throw new Error('Invalid channel');
    }
    
    const messageOptions: MessageCreateOptions = { content };
    
    if (options?.embed) {
      messageOptions.embeds = [this.convertEmbed(options.embed)];
    }
    
    if (options?.buttons?.length) {
      messageOptions.components = [this.createButtonRow(options.buttons)];
    }
    
    const message = await (channel as TextChannel).send(messageOptions);
    return message.id;
  }

  async sendEmbed(channelId: string, embed: MessageEmbed, buttons?: MessageButton[]): Promise<string> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !this.isTextChannel(channel)) {
      throw new Error('Invalid channel');
    }
    
    const messageOptions: MessageCreateOptions = {
      embeds: [this.convertEmbed(embed)],
    };
    
    if (buttons?.length) {
      messageOptions.components = [this.createButtonRow(buttons)];
    }
    
    const message = await (channel as TextChannel).send(messageOptions);
    return message.id;
  }

  async replyToMessage(channelId: string, messageId: string, content: string, options?: SendMessageOptions): Promise<string> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !this.isTextChannel(channel)) {
      throw new Error('Invalid channel');
    }
    
    const originalMessage = await (channel as TextChannel).messages.fetch(messageId);
    
    const messageOptions: MessageCreateOptions = { content };
    
    if (options?.embed) {
      messageOptions.embeds = [this.convertEmbed(options.embed)];
    }
    
    if (options?.buttons?.length) {
      messageOptions.components = [this.createButtonRow(options.buttons)];
    }
    
    const reply = await originalMessage.reply(messageOptions);
    return reply.id;
  }

  async editMessage(channelId: string, messageId: string, content: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !this.isTextChannel(channel)) {
      throw new Error('Invalid channel');
    }
    
    const message = await (channel as TextChannel).messages.fetch(messageId);
    await message.edit(content);
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !this.isTextChannel(channel)) {
      throw new Error('Invalid channel');
    }
    
    const message = await (channel as TextChannel).messages.fetch(messageId);
    await message.delete();
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !this.isTextChannel(channel)) {
      throw new Error('Invalid channel');
    }
    
    const message = await (channel as TextChannel).messages.fetch(messageId);
    await message.react(emoji);
  }

  async getUser(userId: string): Promise<PlatformUserInfo | null> {
    const user = await this.client.users.fetch(userId).catch(() => null);
    if (!user) return null;
    
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarURL() ?? undefined,
      isBot: user.bot,
    };
  }

  async getChannel(channelId: string): Promise<PlatformChannelInfo | null> {
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel) return null;
    
    if (channel.isDMBased()) {
      return {
        id: channel.id,
        name: 'DM',
        type: 'dm',
      };
    }
    
    if ('name' in channel && 'guild' in channel) {
      return {
        id: channel.id,
        name: channel.name ?? 'Unknown',
        type: 'guild',
        guildId: channel.guild?.id,
        guildName: channel.guild?.name,
      };
    }
    
    return {
      id: channel.id,
      name: 'Unknown',
      type: 'group',
    };
  }

  async registerCommands(): Promise<void> {
    console.log('[Discord] Registering slash commands...');
    
    const ottoCommand = new SlashCommandBuilder()
      .setName('otto')
      .setDescription('Otto trading assistant');

    // Add subcommands for each command
    ottoCommand.addSubcommand(sub =>
      sub.setName('help')
        .setDescription('Show available commands')
        .addStringOption(opt => opt.setName('command').setDescription('Command to get help for'))
    );

    ottoCommand.addSubcommand(sub =>
      sub.setName('balance')
        .setDescription('Check your token balances')
        .addStringOption(opt => opt.setName('token').setDescription('Token symbol'))
        .addStringOption(opt => opt.setName('chain').setDescription('Chain name'))
    );

    ottoCommand.addSubcommand(sub =>
      sub.setName('price')
        .setDescription('Get token price')
        .addStringOption(opt => opt.setName('token').setDescription('Token symbol').setRequired(true))
        .addStringOption(opt => opt.setName('chain').setDescription('Chain name'))
    );

    ottoCommand.addSubcommand(sub =>
      sub.setName('swap')
        .setDescription('Swap tokens')
        .addStringOption(opt => opt.setName('amount').setDescription('Amount to swap').setRequired(true))
        .addStringOption(opt => opt.setName('from').setDescription('From token').setRequired(true))
        .addStringOption(opt => opt.setName('to').setDescription('To token').setRequired(true))
        .addStringOption(opt => opt.setName('chain').setDescription('Chain name'))
    );

    ottoCommand.addSubcommand(sub =>
      sub.setName('bridge')
        .setDescription('Bridge tokens across chains')
        .addStringOption(opt => opt.setName('amount').setDescription('Amount to bridge').setRequired(true))
        .addStringOption(opt => opt.setName('token').setDescription('Token symbol').setRequired(true))
        .addStringOption(opt => opt.setName('from_chain').setDescription('Source chain').setRequired(true))
        .addStringOption(opt => opt.setName('to_chain').setDescription('Destination chain').setRequired(true))
    );

    ottoCommand.addSubcommand(sub =>
      sub.setName('send')
        .setDescription('Send tokens to an address')
        .addStringOption(opt => opt.setName('amount').setDescription('Amount to send').setRequired(true))
        .addStringOption(opt => opt.setName('token').setDescription('Token symbol').setRequired(true))
        .addStringOption(opt => opt.setName('to').setDescription('Recipient address or ENS/JNS name').setRequired(true))
    );

    ottoCommand.addSubcommand(sub =>
      sub.setName('launch')
        .setDescription('Launch a new token')
        .addStringOption(opt => opt.setName('name').setDescription('Token name').setRequired(true))
        .addStringOption(opt => opt.setName('symbol').setDescription('Token symbol').setRequired(true))
        .addStringOption(opt => opt.setName('supply').setDescription('Initial supply'))
        .addStringOption(opt => opt.setName('liquidity').setDescription('Initial liquidity in ETH'))
    );

    ottoCommand.addSubcommand(sub =>
      sub.setName('portfolio')
        .setDescription('View your portfolio summary')
        .addStringOption(opt => opt.setName('chain').setDescription('Chain name'))
    );

    ottoCommand.addSubcommand(sub =>
      sub.setName('connect')
        .setDescription('Connect your wallet')
    );

    ottoCommand.addSubcommand(sub =>
      sub.setName('settings')
        .setDescription('View or update settings')
        .addStringOption(opt => opt.setName('key').setDescription('Setting key'))
        .addStringOption(opt => opt.setName('value').setDescription('Setting value'))
    );

    await this.rest.put(
      Routes.applicationCommands(this.applicationId),
      { body: [ottoCommand.toJSON()] }
    );

    console.log('[Discord] Slash commands registered');
  }

  private isTextChannel(channel: unknown): channel is TextChannel | DMChannel {
    return channel !== null && typeof channel === 'object' && 'send' in channel;
  }

  private convertEmbed(embed: MessageEmbed): APIEmbed {
    const builder = new EmbedBuilder();
    
    if (embed.title) builder.setTitle(embed.title);
    if (embed.description) builder.setDescription(embed.description);
    if (embed.color) builder.setColor(embed.color);
    if (embed.footer) builder.setFooter({ text: embed.footer });
    if (embed.timestamp) builder.setTimestamp(embed.timestamp);
    if (embed.imageUrl) builder.setImage(embed.imageUrl);
    if (embed.thumbnailUrl) builder.setThumbnail(embed.thumbnailUrl);
    
    if (embed.fields?.length) {
      builder.addFields(embed.fields.map(f => ({
        name: f.name,
        value: f.value,
        inline: f.inline ?? false,
      })));
    }
    
    return builder.toJSON();
  }

  private createButtonRow(buttons: MessageButton[]): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();
    
    for (const button of buttons) {
      const builder = new ButtonBuilder()
        .setLabel(button.label)
        .setDisabled(button.disabled ?? false);
      
      if (button.url) {
        builder.setStyle(ButtonStyle.Link).setURL(button.url);
      } else if (button.customId) {
        builder.setCustomId(button.customId);
        switch (button.style) {
          case 'primary': builder.setStyle(ButtonStyle.Primary); break;
          case 'secondary': builder.setStyle(ButtonStyle.Secondary); break;
          case 'success': builder.setStyle(ButtonStyle.Success); break;
          case 'danger': builder.setStyle(ButtonStyle.Danger); break;
          default: builder.setStyle(ButtonStyle.Secondary);
        }
      }
      
      row.addComponents(builder);
    }
    
    return row;
  }
}

