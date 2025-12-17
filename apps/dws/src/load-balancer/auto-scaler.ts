/**
 * Auto Scaler
 * Handles scale-to-zero and scale-up logic
 */

import type {
  Instance,
  ServiceDefinition,
  ScalingEvent,
  ScalingAction,
  LoadBalancerConfig,
} from './types';

export class AutoScaler {
  private config: LoadBalancerConfig;
  private services = new Map<string, ServiceDefinition>();
  private instances = new Map<string, Instance[]>();
  private lastScaleUp = new Map<string, number>();
  private lastScaleDown = new Map<string, number>();
  private scalingEvents: ScalingEvent[] = [];
  private instanceFactory: InstanceFactory;

  constructor(config: LoadBalancerConfig, factory: InstanceFactory) {
    this.config = config;
    this.instanceFactory = factory;
  }

  registerService(service: ServiceDefinition): void {
    this.services.set(service.id, service);
    this.instances.set(service.id, []);
    console.log(`[AutoScaler] Registered service: ${service.id}`);
  }

  unregisterService(serviceId: string): void {
    this.services.delete(serviceId);
    this.instances.delete(serviceId);
  }

  getInstances(serviceId: string): Instance[] {
    return this.instances.get(serviceId) ?? [];
  }

  getRunningInstances(serviceId: string): Instance[] {
    return this.getInstances(serviceId).filter(i => i.status === 'running');
  }

  async evaluate(serviceId: string, queueDepth: number, activeConnections: number): Promise<ScalingAction> {
    const service = this.services.get(serviceId);
    if (!service) return 'none';

    const instances = this.getRunningInstances(serviceId);
    const currentCount = instances.length;
    const now = Date.now();

    // Check if we need to scale up
    if (this.shouldScaleUp(service, instances, queueDepth, activeConnections)) {
      const lastUp = this.lastScaleUp.get(serviceId) ?? 0;
      if (now - lastUp >= this.config.scaleUpCooldown) {
        await this.scaleUp(serviceId);
        return 'scale_up';
      }
    }

    // Check if we need to scale down
    if (this.shouldScaleDown(service, instances)) {
      const lastDown = this.lastScaleDown.get(serviceId) ?? 0;
      if (now - lastDown >= this.config.scaleDownCooldown) {
        await this.scaleDown(serviceId);
        return 'scale_down';
      }
    }

    return 'none';
  }

  private shouldScaleUp(
    service: ServiceDefinition,
    instances: Instance[],
    queueDepth: number,
    activeConnections: number
  ): boolean {
    const currentCount = instances.length;
    const maxInstances = service.scaling.maxInstances;

    if (currentCount >= maxInstances) return false;

    // Scale up if queue is building
    if (queueDepth >= this.config.scaleUpThreshold) return true;

    // Scale up if we're at capacity
    const totalCapacity = currentCount * service.scaling.targetConcurrency;
    if (currentCount > 0 && activeConnections >= totalCapacity * 0.8) return true;

    // Scale up from zero if there's any demand
    if (currentCount === 0 && (queueDepth > 0 || activeConnections > 0)) return true;

    return false;
  }

  private shouldScaleDown(service: ServiceDefinition, instances: Instance[]): boolean {
    const currentCount = instances.length;
    const minInstances = service.scaling.minInstances;

    if (currentCount <= minInstances) return false;

    const now = Date.now();
    const idleInstances = instances.filter(
      i => i.currentConnections === 0 && 
           now - i.lastActivityAt > this.config.scaleDownThreshold
    );

    // Scale down if we have idle instances above minimum
    return idleInstances.length > 0 && currentCount > minInstances;
  }

  async scaleUp(serviceId: string): Promise<Instance | null> {
    const service = this.services.get(serviceId);
    if (!service) return null;

    const instances = this.instances.get(serviceId) ?? [];
    if (instances.length >= service.scaling.maxInstances) return null;

    console.log(`[AutoScaler] Scaling up ${serviceId}: ${instances.length} -> ${instances.length + 1}`);

    const instance = await this.instanceFactory.create(service);
    instances.push(instance);
    this.instances.set(serviceId, instances);
    this.lastScaleUp.set(serviceId, Date.now());

    this.recordEvent({
      action: 'scale_up',
      serviceId,
      fromCount: instances.length - 1,
      toCount: instances.length,
      reason: 'Demand increase',
      timestamp: Date.now(),
    });

    return instance;
  }

  async scaleDown(serviceId: string): Promise<boolean> {
    const service = this.services.get(serviceId);
    if (!service) return false;

    const instances = this.instances.get(serviceId) ?? [];
    if (instances.length <= service.scaling.minInstances) return false;

    // Find the most idle instance
    const idleInstance = instances
      .filter(i => i.status === 'running' && i.currentConnections === 0)
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0];

    if (!idleInstance) return false;

    console.log(`[AutoScaler] Scaling down ${serviceId}: ${instances.length} -> ${instances.length - 1}`);

    // Start draining
    idleInstance.status = 'draining';
    
    // Wait for drain timeout then stop
    await this.drainAndStop(idleInstance);

    const remaining = instances.filter(i => i.id !== idleInstance.id);
    this.instances.set(serviceId, remaining);
    this.lastScaleDown.set(serviceId, Date.now());

    this.recordEvent({
      action: 'scale_down',
      serviceId,
      fromCount: instances.length,
      toCount: remaining.length,
      reason: 'Idle instance',
      timestamp: Date.now(),
    });

    return true;
  }

  private async drainAndStop(instance: Instance): Promise<void> {
    // Wait for connections to drain or timeout
    const deadline = Date.now() + this.config.connectionDrainTimeout;
    
    while (instance.currentConnections > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1000));
    }

    instance.status = 'stopped';
    await this.instanceFactory.destroy(instance);
  }

  async ensureMinimum(serviceId: string): Promise<void> {
    const service = this.services.get(serviceId);
    if (!service) return;

    const instances = this.getRunningInstances(serviceId);
    const needed = service.scaling.minInstances - instances.length;

    for (let i = 0; i < needed; i++) {
      await this.scaleUp(serviceId);
    }
  }

  private recordEvent(event: ScalingEvent): void {
    this.scalingEvents.push(event);
    // Keep last 1000 events
    if (this.scalingEvents.length > 1000) {
      this.scalingEvents = this.scalingEvents.slice(-1000);
    }
  }

  getScalingEvents(limit = 100): ScalingEvent[] {
    return this.scalingEvents.slice(-limit);
  }

  getStats() {
    let totalInstances = 0;
    let runningInstances = 0;

    for (const instances of this.instances.values()) {
      totalInstances += instances.length;
      runningInstances += instances.filter(i => i.status === 'running').length;
    }

    return {
      services: this.services.size,
      totalInstances,
      runningInstances,
      recentScalingEvents: this.scalingEvents.slice(-10),
    };
  }
}

export interface InstanceFactory {
  create(service: ServiceDefinition): Promise<Instance>;
  destroy(instance: Instance): Promise<void>;
  healthCheck(instance: Instance): Promise<boolean>;
}

/**
 * Default instance factory - spawns local processes
 * In production, this would interface with Akash/Vast.ai/K8s
 */
export class LocalInstanceFactory implements InstanceFactory {
  private processes = new Map<string, ReturnType<typeof Bun.spawn>>();

  async create(service: ServiceDefinition): Promise<Instance> {
    const id = crypto.randomUUID();
    const port = 10000 + Math.floor(Math.random() * 10000);
    
    const instance: Instance = {
      id,
      serviceId: service.id,
      endpoint: `http://localhost:${port}`,
      status: 'starting',
      region: 'local',
      operator: '0x0000000000000000000000000000000000000000',
      currentConnections: 0,
      totalRequests: 0,
      avgLatencyMs: 0,
      lastHealthCheck: Date.now(),
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      metadata: { port: String(port) },
    };

    // For workers with entrypoints, spawn the process
    if (service.entrypoint) {
      const proc = Bun.spawn(['bun', 'run', service.entrypoint], {
        env: {
          ...process.env,
          ...service.env,
          PORT: String(port),
          INSTANCE_ID: id,
        },
        stdout: 'inherit',
        stderr: 'inherit',
      });
      this.processes.set(id, proc);
    }

    // Wait for health check
    const healthy = await this.waitForHealthy(instance, service.healthCheck);
    instance.status = healthy ? 'running' : 'error';

    return instance;
  }

  private async waitForHealthy(
    instance: Instance,
    healthCheck: { path: string; timeout: number }
  ): Promise<boolean> {
    const deadline = Date.now() + healthCheck.timeout;
    
    while (Date.now() < deadline) {
      const healthy = await this.healthCheck(instance).catch(() => false);
      if (healthy) return true;
      await new Promise(r => setTimeout(r, 1000));
    }
    
    return false;
  }

  async healthCheck(instance: Instance): Promise<boolean> {
    const response = await fetch(`${instance.endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    return response?.ok ?? false;
  }

  async destroy(instance: Instance): Promise<void> {
    const proc = this.processes.get(instance.id);
    if (proc) {
      proc.kill();
      this.processes.delete(instance.id);
    }
  }
}

