/**
 * Farcaster Authentication Provider
 * 
 * Best-in-class Farcaster integration with:
 * - Custody address verification
 * - Signer key delegation
 * - Frame authentication
 * - Verified address linking
 * - Profile data fetching
 * 
 * Uses permissionless Hub access when NEYNAR_API_KEY is not set.
 * Set FARCASTER_HUB_URL to use a self-hosted hub (default: public hub).
 */

import { keccak256, toBytes, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import type {
  AuthProvider,
  FarcasterIdentity,
  FarcasterSignerRequest,
  LinkedProvider,
} from '../types.js';
import {
  NeynarUserSchema,
  NeynarCastSchema,
  HubUserDataResponseSchema,
  HubVerificationsResponseSchema,
  HubUsernameProofSchema,
  FrameValidationResponseSchema,
  type NeynarUser,
  type NeynarCast,
  validateResponse,
} from '../validation.js';

const FARCASTER_HUB_URL = process.env.FARCASTER_HUB_URL ?? 'https://nemes.farcaster.xyz:2281';
const FARCASTER_API_URL = process.env.FARCASTER_API_URL ?? 'https://api.neynar.com/v2';
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY ?? '';


export interface FarcasterProfile {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  verifiedAddresses: Address[];
  custodyAddress: Address;
  activeStatus: 'active' | 'inactive';
}

export interface FarcasterSigner {
  signerUuid: string;
  publicKey: Hex;
  status: 'pending_approval' | 'approved' | 'revoked';
  fid: number;
  permissions: string[];
}

export interface FarcasterCast {
  hash: Hex;
  author: FarcasterProfile;
  text: string;
  timestamp: number;
  parentHash?: Hex;
  parentUrl?: string;
  embeds: Array<{ url: string }>;
  reactions: { likes: number; recasts: number };
}

export interface FarcasterFrameContext {
  fid: number;
  url: string;
  messageHash: Hex;
  timestamp: number;
  network: number;
  buttonIndex: number;
  castId?: { fid: number; hash: Hex };
  inputText?: string;
  state?: string;
  transactionId?: Hex;
  address?: Address;
}

export interface FarcasterAuthMessage {
  domain: string;
  address: Address;
  uri: string;
  version: string;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
  notBefore?: string;
  resources?: string[];
  fid?: number;
  custody?: Address;
}

export class FarcasterProvider {
  private apiKey: string;
  private hubUrl: string;
  private apiUrl: string;
  private useHubDirect: boolean;

  constructor(config?: { apiKey?: string; hubUrl?: string; apiUrl?: string }) {
    this.apiKey = config?.apiKey ?? NEYNAR_API_KEY;
    this.hubUrl = config?.hubUrl ?? FARCASTER_HUB_URL;
    this.apiUrl = config?.apiUrl ?? FARCASTER_API_URL;
    this.useHubDirect = !this.apiKey;
  }

  async getProfileByFid(fid: number): Promise<FarcasterProfile> {
    if (this.useHubDirect) {
      return this.getProfileFromHub(fid);
    }

    const response = await fetch(`${this.apiUrl}/farcaster/user/bulk?fids=${fid}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Farcaster profile: ${response.status}`);
    }

    const rawData = await response.json();
    const data = validateResponse(
      z.object({ users: z.array(NeynarUserSchema) }),
      rawData,
      'Neynar user bulk response'
    );
    const user = data.users[0];

    if (!user) {
      throw new Error(`Farcaster user not found: ${fid}`);
    }

    return this.mapNeynarUser(user);
  }

  private async getProfileFromHub(fid: number): Promise<FarcasterProfile> {
    const userDataResponse = await fetch(`${this.hubUrl}/v1/userDataByFid?fid=${fid}`);
    if (!userDataResponse.ok) {
      throw new Error(`Failed to fetch user data from hub: ${userDataResponse.status}`);
    }

    const rawUserData = await userDataResponse.json();
    const userData = validateResponse(HubUserDataResponseSchema, rawUserData, 'Hub user data response');

    const verificationsResponse = await fetch(`${this.hubUrl}/v1/verificationsByFid?fid=${fid}`);
    const verifications = verificationsResponse.ok 
      ? validateResponse(HubVerificationsResponseSchema, await verificationsResponse.json(), 'Hub verifications response')
      : { messages: [] };

    const profile: FarcasterProfile = {
      fid,
      username: '',
      displayName: '',
      pfpUrl: '',
      bio: '',
      followerCount: 0,
      followingCount: 0,
      verifiedAddresses: [],
      custodyAddress: '0x0' as Address,
      activeStatus: 'active',
    };

    for (const msg of userData.messages) {
      const type = msg.data.userDataBody.type;
      const value = msg.data.userDataBody.value;
      
      if (type === 'USER_DATA_TYPE_USERNAME') profile.username = value;
      else if (type === 'USER_DATA_TYPE_DISPLAY') profile.displayName = value;
      else if (type === 'USER_DATA_TYPE_PFP') profile.pfpUrl = value;
      else if (type === 'USER_DATA_TYPE_BIO') profile.bio = value;
    }

    profile.verifiedAddresses = verifications.messages
      .filter((m) => m.data.verificationAddAddressBody?.protocol !== 'PROTOCOL_SOLANA')
      .map((m) => m.data.verificationAddAddressBody?.address as Address)
      .filter(Boolean);

    return profile;
  }

  async getProfileByUsername(username: string): Promise<FarcasterProfile> {
    if (this.useHubDirect) {
      return this.getProfileByUsernameFromHub(username);
    }

    const response = await fetch(`${this.apiUrl}/farcaster/user/by_username?username=${username}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Farcaster profile: ${response.status}`);
    }

    const rawData = await response.json();
    const data = validateResponse(
      z.object({ user: NeynarUserSchema }),
      rawData,
      'Neynar user by username response'
    );
    return this.mapNeynarUser(data.user);
  }

  private async getProfileByUsernameFromHub(username: string): Promise<FarcasterProfile> {
    const proofResponse = await fetch(`${this.hubUrl}/v1/userNameProofByName?name=${username}`);
    if (!proofResponse.ok) {
      throw new Error(`Username not found: ${username}`);
    }

    const rawProof = await proofResponse.json();
    const proof = validateResponse(HubUsernameProofSchema, rawProof, 'Hub username proof');
    return this.getProfileFromHub(proof.fid);
  }

  async getProfileByVerifiedAddress(address: Address): Promise<FarcasterProfile | null> {
    if (this.useHubDirect) {
      return this.getProfileByVerifiedAddressFromHub(address);
    }

    const response = await fetch(
      `${this.apiUrl}/farcaster/user/bulk-by-address?addresses=${address.toLowerCase()}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      return null;
    }

    const rawData = await response.json();
    const schema = z.record(z.string(), z.array(NeynarUserSchema));
    const result = schema.safeParse(rawData);
    if (!result.success) {
      return null;
    }
    
    const users = result.data[address.toLowerCase()];
    if (!users || users.length === 0) {
      return null;
    }

    return this.mapNeynarUser(users[0]);
  }

  private async getProfileByVerifiedAddressFromHub(address: Address): Promise<FarcasterProfile | null> {
    const response = await fetch(`${this.hubUrl}/v1/verificationsByFid?address=${address.toLowerCase()}`);
    if (!response.ok) {
      return null;
    }

    const rawData = await response.json();
    const result = HubVerificationsResponseSchema.safeParse(rawData);
    if (!result.success || result.data.messages.length === 0) {
      return null;
    }

    const fid = result.data.messages[0].data.fid;
    if (fid === undefined) {
      return null;
    }

    return this.getProfileFromHub(fid);
  }

  async verifySignInMessage(
    message: string,
    signature: Hex,
    expectedFid?: number
  ): Promise<{ valid: boolean; fid: number; custodyAddress: Address }> {
    const parsedMessage = this.parseSignInMessage(message);

    if (!parsedMessage.fid) {
      throw new Error('FID not found in message');
    }

    if (expectedFid && parsedMessage.fid !== expectedFid) {
      return { valid: false, fid: parsedMessage.fid, custodyAddress: parsedMessage.custody! };
    }

    const profile = await this.getProfileByFid(parsedMessage.fid);
    const messageHash = keccak256(toBytes(message));
    
    const response = await fetch(`${this.apiUrl}/farcaster/user/verify`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        fid: parsedMessage.fid,
        message_hash: messageHash,
        signature,
      }),
    });

    if (!response.ok) {
      return { valid: false, fid: parsedMessage.fid, custodyAddress: profile.custodyAddress };
    }

    const rawData = await response.json();
    const data = validateResponse(z.object({ valid: z.boolean() }), rawData, 'Verify response');

    return {
      valid: data.valid,
      fid: parsedMessage.fid,
      custodyAddress: profile.custodyAddress,
    };
  }

  async createSignerRequest(
    fid: number,
    appName: string,
    appFid: number
  ): Promise<FarcasterSignerRequest> {
    const signerKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const signerKeyHex = toHex(signerKeyBytes) as Hex;
    const signerAccount = privateKeyToAccount(signerKeyHex);

    const deadline = Math.floor(Date.now() / 1000) + 86400;

    const message = keccak256(toBytes(
      `Add signer ${signerAccount.address} for FID ${fid} by app ${appName} (FID ${appFid}) before ${deadline}`
    ));

    const signature = await signerAccount.signMessage({ message: { raw: toBytes(message) } });

    return {
      fid,
      signerPublicKey: toHex(signerAccount.publicKey),
      signature,
      deadline,
    };
  }

  async registerSigner(request: FarcasterSignerRequest): Promise<FarcasterSigner> {
    const response = await fetch(`${this.apiUrl}/farcaster/signer/signed_key`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        signer_uuid: crypto.randomUUID(),
        public_key: request.signerPublicKey,
        fid: request.fid,
        deadline: request.deadline,
        signature: request.signature,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to register signer: ${response.status}`);
    }

    const rawData = await response.json();
    const schema = z.object({
      signerUuid: z.string(),
      publicKey: z.string(),
      status: z.enum(['pending_approval', 'approved', 'revoked']),
      fid: z.number().int(),
      permissions: z.array(z.string()),
    });
    
    const data = validateResponse(schema, rawData, 'Signer registration response');
    return {
      signerUuid: data.signerUuid,
      publicKey: data.publicKey as Hex,
      status: data.status,
      fid: data.fid,
      permissions: data.permissions,
    };
  }

  async validateFrameMessage(
    frameMessageBytes: Uint8Array
  ): Promise<{ valid: boolean; context: FarcasterFrameContext }> {
    const response = await fetch(`${this.apiUrl}/farcaster/frame/validate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        message_bytes_in_hex: toHex(frameMessageBytes),
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to validate frame message: ${response.status}`);
    }

    const rawData = await response.json();
    const data = validateResponse(FrameValidationResponseSchema, rawData, 'Frame validation response');

    return {
      valid: data.valid,
      context: {
        fid: data.action.interactor.fid,
        url: data.action.url,
        messageHash: data.action.message_hash as Hex,
        timestamp: data.action.timestamp,
        network: data.action.network,
        buttonIndex: data.action.button_index,
        castId: data.action.cast_id ? {
          fid: data.action.cast_id.fid,
          hash: data.action.cast_id.hash as Hex,
        } : undefined,
        inputText: data.action.input_text,
        state: data.action.state,
        transactionId: data.action.transaction_id as Hex | undefined,
        address: data.action.address as Address | undefined,
      },
    };
  }

  async getCastsByFid(fid: number, limit = 25): Promise<FarcasterCast[]> {
    const response = await fetch(
      `${this.apiUrl}/farcaster/feed/user/casts?fid=${fid}&limit=${limit}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch casts: ${response.status}`);
    }

    const rawData = await response.json();
    const data = validateResponse(
      z.object({ casts: z.array(NeynarCastSchema) }),
      rawData,
      'Neynar casts response'
    );
    return data.casts.map(this.mapNeynarCast);
  }

  generateSignInMessage(params: {
    domain: string;
    address: Address;
    fid: number;
    custody: Address;
    nonce?: string;
    expirationMinutes?: number;
    resources?: string[];
  }): string {
    const now = new Date();
    const nonce = params.nonce ?? crypto.randomUUID();
    const expirationTime = new Date(now.getTime() + (params.expirationMinutes ?? 60) * 60 * 1000);

    const message: FarcasterAuthMessage = {
      domain: params.domain,
      address: params.address,
      uri: `https://${params.domain}`,
      version: '1',
      nonce,
      issuedAt: now.toISOString(),
      expirationTime: expirationTime.toISOString(),
      fid: params.fid,
      custody: params.custody,
      resources: params.resources,
    };

    return this.formatSignInMessage(message);
  }

  private formatSignInMessage(msg: FarcasterAuthMessage): string {
    let message = `${msg.domain} wants you to sign in with your Ethereum account:\n`;
    message += `${msg.address}\n\n`;
    message += `Sign in with Farcaster\n\n`;
    message += `URI: ${msg.uri}\n`;
    message += `Version: ${msg.version}\n`;
    message += `Chain ID: 1\n`;
    message += `Nonce: ${msg.nonce}\n`;
    message += `Issued At: ${msg.issuedAt}\n`;
    
    if (msg.expirationTime) {
      message += `Expiration Time: ${msg.expirationTime}\n`;
    }
    
    if (msg.fid) {
      message += `FID: ${msg.fid}\n`;
    }
    
    if (msg.custody) {
      message += `Custody: ${msg.custody}\n`;
    }
    
    if (msg.resources && msg.resources.length > 0) {
      message += `Resources:\n`;
      for (const resource of msg.resources) {
        message += `- ${resource}\n`;
      }
    }

    return message;
  }

  private parseSignInMessage(message: string): FarcasterAuthMessage {
    const lines = message.split('\n');
    const result: Partial<FarcasterAuthMessage> = {};

    for (const line of lines) {
      if (line.startsWith('URI: ')) result.uri = line.slice(5);
      else if (line.startsWith('Version: ')) result.version = line.slice(9);
      else if (line.startsWith('Nonce: ')) result.nonce = line.slice(7);
      else if (line.startsWith('Issued At: ')) result.issuedAt = line.slice(11);
      else if (line.startsWith('Expiration Time: ')) result.expirationTime = line.slice(17);
      else if (line.startsWith('FID: ')) result.fid = parseInt(line.slice(5));
      else if (line.startsWith('Custody: ')) result.custody = line.slice(9) as Address;
      else if (line.match(/^0x[a-fA-F0-9]{40}$/)) result.address = line as Address;
      else if (line.includes(' wants you to sign in')) {
        result.domain = line.split(' wants you to sign in')[0];
      }
    }

    return result as FarcasterAuthMessage;
  }

  async toLinkedProvider(fid: number): Promise<LinkedProvider> {
    const profile = await this.getProfileByFid(fid);

    return {
      provider: 'farcaster' as AuthProvider,
      providerId: String(fid),
      providerHandle: profile.username,
      linkedAt: Date.now(),
      verified: true,
      credential: null,
    };
  }

  async toFarcasterIdentity(fid: number): Promise<FarcasterIdentity> {
    const profile = await this.getProfileByFid(fid);

    return {
      fid: profile.fid,
      username: profile.username,
      displayName: profile.displayName,
      pfpUrl: profile.pfpUrl,
      bio: profile.bio,
      custodyAddress: profile.custodyAddress,
      verifiedAddresses: profile.verifiedAddresses,
      signerPublicKey: '0x' as Hex,
    };
  }

  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(this.apiKey && { 'api_key': this.apiKey }),
    };
  }

  private mapNeynarUser(user: NeynarUser): FarcasterProfile {
    return {
      fid: user.fid,
      username: user.username,
      displayName: user.display_name,
      pfpUrl: user.pfp_url,
      bio: user.profile?.bio?.text ?? '',
      followerCount: user.follower_count,
      followingCount: user.following_count,
      verifiedAddresses: (user.verified_addresses?.eth_addresses ?? []) as Address[],
      custodyAddress: user.custody_address as Address,
      activeStatus: user.active_status as 'active' | 'inactive',
    };
  }

  private mapNeynarCast(cast: NeynarCast): FarcasterCast {
    return {
      hash: cast.hash as Hex,
      author: this.mapNeynarUser(cast.author),
      text: cast.text,
      timestamp: new Date(cast.timestamp).getTime(),
      parentHash: cast.parent_hash as Hex | undefined,
      parentUrl: cast.parent_url,
      embeds: cast.embeds ?? [],
      reactions: {
        likes: cast.reactions?.likes_count ?? 0,
        recasts: cast.reactions?.recasts_count ?? 0,
      },
    };
  }
}

export const farcasterProvider = new FarcasterProvider();
