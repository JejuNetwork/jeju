import {
  Service,
  elizaLogger,
  type IAgentRuntime,
  ServiceType,
  type ServiceTypeName,
} from '@elizaos/core';

export class SecretsManagerService extends Service {
  static serviceName: string = 'secrets-manager';
  static serviceType: ServiceTypeName = ServiceType.UNKNOWN;
  protected runtime: IAgentRuntime;
  private secrets: Map<string, string> = new Map();

  constructor(runtime: IAgentRuntime) {
    super();
    this.runtime = runtime;
  }

  get capabilityDescription(): string {
    return 'Manages API keys and secrets for generated projects';
  }

  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new SecretsManagerService(runtime);
    await service.start();
    return service;
  }

  async start(): Promise<void> {
    elizaLogger.info('Starting SecretsManagerService');
    // Load existing secrets from runtime settings
    this.loadSecretsFromRuntime();
    elizaLogger.info('SecretsManagerService started successfully');
  }

  async stop(): Promise<void> {
    elizaLogger.info('Stopping SecretsManagerService');
    this.secrets.clear();
  }

  private loadSecretsFromRuntime(): void {
    // Load common API keys from runtime settings
    const commonKeys = [
      'GITHUB_TOKEN',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GOOGLE_API_KEY',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
    ];

    for (const key of commonKeys) {
      const value = this.runtime.getSetting(key);
      if (value) {
        this.secrets.set(key, value);
      }
    }
  }

  async getSecret(key: string): Promise<string | null> {
    return this.secrets.get(key) || this.runtime.getSetting(key) || null;
  }

  async setSecret(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
    elizaLogger.info(`Secret stored: ${key}`);
  }

  async hasSecret(key: string): Promise<boolean> {
    return this.secrets.has(key) || !!this.runtime.getSetting(key);
  }

  async listSecretKeys(): Promise<string[]> {
    return Array.from(this.secrets.keys());
  }
}
