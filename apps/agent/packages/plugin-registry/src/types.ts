/**
 * Types for Registry Plugin
 */

export interface DiscoveredApp {
  agentId: bigint;
  name: string;
  description?: string;
  owner: string;
  tags: string[];
  a2aEndpoint?: string;
  capabilities?: A2ACapability[];
  stakeToken: string;
  stakeAmount: bigint;
}

export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  preferredTransport: string;
  provider: {
    organization: string;
    url: string;
  };
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2ASkill[];
}

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
}

export interface A2ACapability {
  skillId: string;
  name: string;
  description: string;
}

export interface ConnectedApp {
  agentId: bigint;
  name: string;
  endpoint: string;
  capabilities: A2ACapability[];
  connectedAt: Date;
}

export const REGISTRY_ABI = [
  {
    "inputs": [{"internalType": "string", "name": "tag", "type": "string"}],
    "name": "getAgentsByTag",
    "outputs": [{"internalType": "uint256[]", "name": "agentIds", "type": "uint256[]"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "offset", "type": "uint256"},
      {"internalType": "uint256", "name": "limit", "type": "uint256"}
    ],
    "name": "getAllAgents",
    "outputs": [{"internalType": "uint256[]", "name": "agentIds", "type": "uint256[]"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
    "name": "tokenURI",
    "outputs": [{"internalType": "string", "name": "", "type": "string"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
    "name": "getAgentTags",
    "outputs": [{"internalType": "string[]", "name": "tags", "type": "string[]"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "uint256", "name": "agentId", "type": "uint256"},
      {"internalType": "string", "name": "key", "type": "string"}
    ],
    "name": "getMetadata",
    "outputs": [{"internalType": "bytes", "name": "value", "type": "bytes"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "uint256", "name": "agentId", "type": "uint256"}],
    "name": "ownerOf",
    "outputs": [{"internalType": "address", "name": "owner", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

