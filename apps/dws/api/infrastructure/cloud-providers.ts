/**
 * AWS Cloud Provider for Nitro TEE Database
 *
 * Provides EC2 instance management with Nitro Enclave support
 * for running PostgreSQL in hardware-backed TEE.
 */

import {
  EC2Client,
  RunInstancesCommand,
  DescribeInstancesCommand,
  TerminateInstancesCommand,
  DescribeImagesCommand,
  type _InstanceType,
} from '@aws-sdk/client-ec2'

export interface CloudProviderConfig {
  provider: 'aws'
  apiKey?: string
  apiSecret?: string
  region: string
}

export interface CreateInstanceRequest {
  instanceType: string
  region: string
  name: string
  userData?: string
  tags?: Record<string, string>
}

export interface CloudInstance {
  id: string
  name: string
  status: 'pending' | 'running' | 'stopped' | 'terminated'
  publicIp: string | null
  privateIp: string | null
  instanceType: string
  region: string
  createdAt: number
}

export class AWSProvider {
  private ec2Client: EC2Client | null = null
  private region: string = 'us-east-1'
  private initialized = false

  async initialize(config: CloudProviderConfig): Promise<void> {
    this.region = config.region

    const clientConfig: { region: string; credentials?: { accessKeyId: string; secretAccessKey: string } } = {
      region: config.region,
    }

    if (config.apiKey && config.apiSecret) {
      clientConfig.credentials = {
        accessKeyId: config.apiKey,
        secretAccessKey: config.apiSecret,
      }
    }

    this.ec2Client = new EC2Client(clientConfig)
    this.initialized = true
  }

  isInitialized(): boolean {
    return this.initialized
  }

  private async getLatestAmazonLinux2Ami(): Promise<string> {
    if (!this.ec2Client) throw new Error('EC2 client not initialized')

    const response = await this.ec2Client.send(
      new DescribeImagesCommand({
        Owners: ['amazon'],
        Filters: [
          { Name: 'name', Values: ['amzn2-ami-hvm-*-x86_64-gp2'] },
          { Name: 'state', Values: ['available'] },
          { Name: 'architecture', Values: ['x86_64'] },
        ],
      }),
    )

    const images = response.Images ?? []
    if (images.length === 0) {
      throw new Error('No Amazon Linux 2 AMI found')
    }

    // Sort by creation date descending
    images.sort((a, b) => {
      const dateA = a.CreationDate ?? ''
      const dateB = b.CreationDate ?? ''
      return dateB.localeCompare(dateA)
    })

    const amiId = images[0].ImageId
    if (!amiId) throw new Error('AMI ID not found')
    return amiId
  }

  async createInstance(request: CreateInstanceRequest): Promise<CloudInstance> {
    if (!this.ec2Client) throw new Error('EC2 client not initialized')

    const amiId = await this.getLatestAmazonLinux2Ami()

    const tags = [
      { Key: 'Name', Value: request.name },
      ...Object.entries(request.tags ?? {}).map(([Key, Value]) => ({ Key, Value })),
    ]

    const response = await this.ec2Client.send(
      new RunInstancesCommand({
        ImageId: amiId,
        InstanceType: request.instanceType as _InstanceType,
        MinCount: 1,
        MaxCount: 1,
        UserData: request.userData ? Buffer.from(request.userData).toString('base64') : undefined,
        EnclaveOptions: { Enabled: true },
        TagSpecifications: [
          {
            ResourceType: 'instance',
            Tags: tags,
          },
        ],
        BlockDeviceMappings: [
          {
            DeviceName: '/dev/xvda',
            Ebs: {
              VolumeSize: 100,
              VolumeType: 'gp3',
              Encrypted: true,
              DeleteOnTermination: true,
            },
          },
        ],
      }),
    )

    const instance = response.Instances?.[0]
    if (!instance?.InstanceId) {
      throw new Error('Failed to create instance')
    }

    return {
      id: instance.InstanceId,
      name: request.name,
      status: 'pending',
      publicIp: instance.PublicIpAddress ?? null,
      privateIp: instance.PrivateIpAddress ?? null,
      instanceType: request.instanceType,
      region: this.region,
      createdAt: Date.now(),
    }
  }

  async getInstance(instanceId: string): Promise<CloudInstance | null> {
    if (!this.ec2Client) throw new Error('EC2 client not initialized')

    const response = await this.ec2Client.send(
      new DescribeInstancesCommand({
        InstanceIds: [instanceId],
      }),
    )

    const reservation = response.Reservations?.[0]
    const instance = reservation?.Instances?.[0]
    if (!instance) return null

    const nameTag = instance.Tags?.find((t) => t.Key === 'Name')

    const stateMap: Record<string, CloudInstance['status']> = {
      pending: 'pending',
      running: 'running',
      stopped: 'stopped',
      terminated: 'terminated',
      'shutting-down': 'terminated',
      stopping: 'stopped',
    }

    return {
      id: instance.InstanceId ?? instanceId,
      name: nameTag?.Value ?? 'unknown',
      status: stateMap[instance.State?.Name ?? 'pending'] ?? 'pending',
      publicIp: instance.PublicIpAddress ?? null,
      privateIp: instance.PrivateIpAddress ?? null,
      instanceType: instance.InstanceType ?? 'unknown',
      region: this.region,
      createdAt: instance.LaunchTime?.getTime() ?? Date.now(),
    }
  }

  async deleteInstance(instanceId: string): Promise<void> {
    if (!this.ec2Client) throw new Error('EC2 client not initialized')

    await this.ec2Client.send(
      new TerminateInstancesCommand({
        InstanceIds: [instanceId],
      }),
    )
  }
}
