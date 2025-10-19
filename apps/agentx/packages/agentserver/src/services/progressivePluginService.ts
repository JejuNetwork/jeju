import { IAgentRuntime, logger, Service, ServiceType, Plugin } from '@elizaos/core';

/**
 * Service responsible for progressive plugin registration and management.
 * Handles dynamic plugin loading based on capability unlocks.
 */
export class ProgressivePluginService extends Service {
  static serviceType = ServiceType.UNKNOWN;
  static serviceName = 'PROGRESSIVE_PLUGIN';
  capabilityDescription = 'Manages progressive plugin registration for capability unlocks';

  private availablePlugins: Record<string, Plugin[]>;

  constructor(runtime?: IAgentRuntime, availablePlugins?: Record<string, Plugin[]>) {
    super(runtime);
    if (!runtime) return; // For service construction pattern

    this.availablePlugins = availablePlugins || {};
    logger.info('[PROGRESSIVE_PLUGIN] Service initialized');
  }

  /**
   * Set the available plugins that can be registered progressively
   */
  public setAvailablePlugins(plugins: Record<string, Plugin[]>): void {
    this.availablePlugins = plugins;
    logger.info('[PROGRESSIVE_PLUGIN] Available plugins updated');
  }

  /**
   * Register plugins for a specific capability
   */
  public async registerCapabilityPlugins(capability: string): Promise<void> {
    logger.info(`[PROGRESSIVE_PLUGIN] Registering plugins for capability: ${capability}`);

    const pluginsToRegister = this.availablePlugins[capability] || [];
    logger.info(
      `[PROGRESSIVE_PLUGIN] Found ${pluginsToRegister.length} plugins to register for ${capability}`
    );

    for (const plugin of pluginsToRegister) {
      if (!this.runtime.plugins.find((p) => p.name === plugin.name)) {
        logger.info(
          `[PROGRESSIVE_PLUGIN] Registering plugin: ${plugin.name} for capability: ${capability}`
        );

        
          await this.runtime.registerPlugin(plugin);
          logger.info(`[PROGRESSIVE_PLUGIN] Successfully registered plugin: ${plugin.name}`);
        
      } else {
        logger.info(`[PROGRESSIVE_PLUGIN] Plugin ${plugin.name} already registered`);
      }
    }
  }

  /**
   * Check if a capability has plugins available for registration
   */
  public hasPluginsForCapability(capability: string): boolean {
    return this.availablePlugins[capability]?.length > 0;
  }

  /**
   * Get the list of plugins that would be registered for a capability
   */
  public getPluginsForCapability(capability: string): Plugin[] {
    return this.availablePlugins[capability] || [];
  }

  /**
   * Check if a plugin is already registered
   */
  public isPluginRegistered(pluginName: string): boolean {
    return this.runtime.plugins.some((p) => p.name === pluginName);
  }

  /**
   * Get all available capabilities that have plugins
   */
  public getAvailableCapabilities(): string[] {
    return Object.keys(this.availablePlugins);
  }

  static async start(runtime: IAgentRuntime): Promise<ProgressivePluginService> {
    const service = new ProgressivePluginService(runtime);
    return service;
  }

  async stop(): Promise<void> {
    // No cleanup needed for this service
    logger.info('[PROGRESSIVE_PLUGIN] Service stopped');
  }
}
