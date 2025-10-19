/**
 * ERC-8004 API Endpoints
 * REST endpoints for service discovery and connection
 */

import type { Request, Response } from 'express';
import { ERC8004RegistryClient } from '../../erc8004/registry';
import { ServiceConnectionManager } from '../../erc8004/connectionManager';
import type { ServiceFilters } from '../../erc8004/types';

const clients = new Map<string, ERC8004RegistryClient>();
const managers = new Map<string, ServiceConnectionManager>();

function getClient(agentId: string): ERC8004RegistryClient {
  if (!clients.has(agentId)) {
    const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
    const privateKey = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    
    const client = new ERC8004RegistryClient(rpcUrl, privateKey);
    clients.set(agentId, client);
  }
  return clients.get(agentId)!;
}

function getManager(agentId: string): ServiceConnectionManager {
  if (!managers.has(agentId)) {
    const manager = new ServiceConnectionManager(getClient(agentId));
    managers.set(agentId, manager);
  }
  return managers.get(agentId)!;
}

export async function listServices(req: Request, res: Response) {
  try {
    const agentId = req.params.agentId || 'default';
    const client = getClient(agentId);
    
    await client.initialize();

    const filters: ServiceFilters = {};
    if (req.query.type) filters.type = req.query.type as ServiceFilters['type'];
    if (req.query.search) filters.searchTerm = req.query.search as string;
    if (req.query.minReputation) filters.minReputation = parseInt(req.query.minReputation as string);

    const services = await client.listServices(filters);

    res.json({
      success: true,
      services,
      count: services.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list services'
    });
  }
}

export async function getService(req: Request, res: Response) {
  try {
    const agentId = req.params.agentId || 'default';
    const serviceId = BigInt(req.params.serviceId);
    
    const client = getClient(agentId);
    await client.initialize();

    const service = await client.getService(serviceId);

    if (!service) {
      res.status(404).json({
        success: false,
        error: 'Service not found'
      });
      return;
    }

    res.json({
      success: true,
      service
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get service'
    });
  }
}

export async function connectToService(req: Request, res: Response) {
  try {
    const agentId = req.params.agentId || 'default';
    const serviceId = BigInt(req.body.serviceId);
    
    const manager = getManager(agentId);
    const connection = await manager.connect(serviceId);

    res.json({
      success: true,
      connection: {
        serviceId: connection.serviceId.toString(),
        serviceName: connection.service.name,
        connected: connection.connected,
        connectedAt: connection.connectedAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to connect'
    });
  }
}

export async function disconnectFromService(req: Request, res: Response) {
  try {
    const agentId = req.params.agentId || 'default';
    const serviceId = BigInt(req.body.serviceId);
    
    const manager = getManager(agentId);
    await manager.disconnect(serviceId);

    res.json({
      success: true,
      message: `Disconnected from service ${serviceId}`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to disconnect'
    });
  }
}

export async function listConnections(req: Request, res: Response) {
  try {
    const agentId = req.params.agentId || 'default';
    const manager = getManager(agentId);
    
    const connections = manager.getAllConnections();

    res.json({
      success: true,
      connections: connections.map(c => ({
        serviceId: c.serviceId.toString(),
        serviceName: c.service.name,
        connected: c.connected,
        connectedAt: c.connectedAt
      })),
      count: connections.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list connections'
    });
  }
}

export async function sendToService(req: Request, res: Response) {
  try {
    const agentId = req.params.agentId || 'default';
    const serviceId = BigInt(req.body.serviceId);
    const message = req.body.message;

    if (!message) {
      res.status(400).json({
        success: false,
        error: 'Message is required'
      });
      return;
    }

    const manager = getManager(agentId);
    const response = await manager.sendMessage(serviceId, message);

    res.json({
      success: true,
      response: response ? await response.text() : null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send message'
    });
  }
}

