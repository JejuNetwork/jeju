/**
 * Git Federation (ActivityPub)
 * Federated git hosting using ActivityPub protocol
 */

import type { Address, Hex } from 'viem';
import type {
  FederationConfig,
  ActivityPubActor,
  ActivityPubActivity,
  ActivityPubObject,
  ActivityType,
  NodeInfo,
  WebFingerResponse,
  Repository,
  GitUser,
} from './types';
import type { GitRepoManager } from './repo-manager';
import type { SocialManager } from './social';
import { createHash, generateKeyPairSync, createSign, createVerify } from 'crypto';

export interface FederationManagerConfig {
  instanceUrl: string;
  instanceName: string;
  instanceDescription?: string;
  adminEmail?: string;
  repoManager: GitRepoManager;
  socialManager: SocialManager;
  privateKeyPem?: string;
  publicKeyPem?: string;
}

export interface FederatedRepo {
  repoId: Hex;
  actorUrl: string;
  inboxUrl: string;
  outboxUrl: string;
  followersUrl: string;
}

export interface RemoteActor {
  url: string;
  inbox: string;
  publicKey: string;
  lastFetched: number;
}

const ACTIVITY_STREAMS_CONTEXT = 'https://www.w3.org/ns/activitystreams';
const FORGEFED_CONTEXT = 'https://forgefed.org/ns';

export class FederationManager {
  private config: FederationManagerConfig;
  private privateKeyPem: string;
  private publicKeyPem: string;
  private followers: Map<string, Set<string>> = new Map(); // actorId -> follower inbox URLs
  private remoteActors: Map<string, RemoteActor> = new Map();
  private outboxQueue: ActivityPubActivity[] = [];

  constructor(config: FederationManagerConfig) {
    this.config = config;

    // Generate or use provided keys
    if (config.privateKeyPem && config.publicKeyPem) {
      this.privateKeyPem = config.privateKeyPem;
      this.publicKeyPem = config.publicKeyPem;
    } else {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      this.privateKeyPem = privateKey;
      this.publicKeyPem = publicKey;
    }
  }

  // ============ NodeInfo & WebFinger ============

  /**
   * Generate NodeInfo response
   */
  getNodeInfo(): NodeInfo {
    return {
      version: '2.1',
      software: {
        name: 'jeju-git',
        version: '1.0.0',
        repository: 'https://github.com/elizaos/jeju',
      },
      protocols: ['activitypub'],
      usage: {
        users: {
          total: 0, // Would get from database
          activeMonth: 0,
        },
        localPosts: 0,
      },
      openRegistrations: true,
      metadata: {
        nodeName: this.config.instanceName,
        nodeDescription: this.config.instanceDescription || 'A Jeju Git instance',
        features: ['git', 'issues', 'pull-requests', 'stars', 'forks'],
      },
    };
  }

  /**
   * Generate WebFinger response for a resource
   */
  getWebFinger(resource: string): WebFingerResponse | null {
    // Parse acct:user@domain or https://domain/users/user
    const acctMatch = resource.match(/^acct:([^@]+)@(.+)$/);
    const urlMatch = resource.match(new RegExp(`^${this.config.instanceUrl}/users/(.+)$`));

    let username: string | null = null;
    if (acctMatch && acctMatch[2] === new URL(this.config.instanceUrl).host) {
      username = acctMatch[1];
    } else if (urlMatch) {
      username = urlMatch[1];
    }

    if (!username) return null;

    const actorUrl = `${this.config.instanceUrl}/users/${username}`;

    return {
      subject: `acct:${username}@${new URL(this.config.instanceUrl).host}`,
      aliases: [actorUrl],
      links: [
        {
          rel: 'self',
          type: 'application/activity+json',
          href: actorUrl,
        },
        {
          rel: 'http://webfinger.net/rel/profile-page',
          type: 'text/html',
          href: `${this.config.instanceUrl}/${username}`,
        },
      ],
    };
  }

  /**
   * Generate NodeInfo links for .well-known
   */
  getNodeInfoLinks(): { links: Array<{ rel: string; href: string }> } {
    return {
      links: [
        {
          rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1',
          href: `${this.config.instanceUrl}/.well-known/nodeinfo/2.1`,
        },
      ],
    };
  }

  // ============ Actor Generation ============

  /**
   * Generate ActivityPub actor for a user
   */
  getUserActor(user: GitUser): ActivityPubActor {
    const username = user.username || user.address.slice(0, 10);
    const actorUrl = `${this.config.instanceUrl}/users/${username}`;

    return {
      '@context': [ACTIVITY_STREAMS_CONTEXT, FORGEFED_CONTEXT],
      id: actorUrl,
      type: 'Person',
      preferredUsername: username,
      name: user.username || `User ${user.address.slice(0, 8)}`,
      summary: user.bio || '',
      inbox: `${actorUrl}/inbox`,
      outbox: `${actorUrl}/outbox`,
      followers: `${actorUrl}/followers`,
      following: `${actorUrl}/following`,
      publicKey: {
        id: `${actorUrl}#main-key`,
        owner: actorUrl,
        publicKeyPem: this.publicKeyPem,
      },
      icon: user.avatarUrl
        ? {
            type: 'Image',
            url: user.avatarUrl,
            mediaType: 'image/png',
          }
        : undefined,
    };
  }

  /**
   * Generate ActivityPub actor for a repository
   */
  getRepoActor(repo: Repository, ownerUsername: string): ActivityPubActor {
    const actorUrl = `${this.config.instanceUrl}/repos/${ownerUsername}/${repo.name}`;

    return {
      '@context': [ACTIVITY_STREAMS_CONTEXT, FORGEFED_CONTEXT],
      id: actorUrl,
      type: 'Application',
      preferredUsername: `${ownerUsername}/${repo.name}`,
      name: repo.name,
      summary: repo.description || '',
      inbox: `${actorUrl}/inbox`,
      outbox: `${actorUrl}/outbox`,
      followers: `${actorUrl}/followers`,
      publicKey: {
        id: `${actorUrl}#main-key`,
        owner: actorUrl,
        publicKeyPem: this.publicKeyPem,
      },
    };
  }

  // ============ Activity Creation ============

  /**
   * Create a Push activity (custom ForgeFed type)
   */
  createPushActivity(
    repo: Repository,
    ownerUsername: string,
    branch: string,
    commits: string[],
    pusher: Address
  ): ActivityPubActivity {
    const repoUrl = `${this.config.instanceUrl}/repos/${ownerUsername}/${repo.name}`;
    const userUrl = `${this.config.instanceUrl}/users/${pusher.slice(0, 10)}`;

    return {
      '@context': [ACTIVITY_STREAMS_CONTEXT, FORGEFED_CONTEXT],
      id: `${repoUrl}/activities/${Date.now()}`,
      type: 'Push' as ActivityType,
      actor: userUrl,
      object: {
        '@context': [ACTIVITY_STREAMS_CONTEXT, FORGEFED_CONTEXT],
        id: `${repoUrl}/refs/heads/${branch}`,
        type: 'Branch',
        name: branch,
        attributedTo: repoUrl,
      },
      published: new Date().toISOString(),
      to: [`${repoUrl}/followers`],
      cc: [ACTIVITY_STREAMS_CONTEXT + '#Public'],
    };
  }

  /**
   * Create a Star activity
   */
  createStarActivity(repo: Repository, ownerUsername: string, user: Address): ActivityPubActivity {
    const repoUrl = `${this.config.instanceUrl}/repos/${ownerUsername}/${repo.name}`;
    const userUrl = `${this.config.instanceUrl}/users/${user.slice(0, 10)}`;

    return {
      '@context': ACTIVITY_STREAMS_CONTEXT,
      id: `${userUrl}/activities/${Date.now()}`,
      type: 'Like',
      actor: userUrl,
      object: repoUrl,
      published: new Date().toISOString(),
    };
  }

  /**
   * Create a Fork activity
   */
  createForkActivity(
    originalRepo: Repository,
    forkedRepo: Repository,
    ownerUsername: string,
    forker: Address
  ): ActivityPubActivity {
    const originalRepoUrl = `${this.config.instanceUrl}/repos/${ownerUsername}/${originalRepo.name}`;
    const forkerUsername = forker.slice(0, 10);
    const forkedRepoUrl = `${this.config.instanceUrl}/repos/${forkerUsername}/${forkedRepo.name}`;
    const userUrl = `${this.config.instanceUrl}/users/${forkerUsername}`;

    return {
      '@context': [ACTIVITY_STREAMS_CONTEXT, FORGEFED_CONTEXT],
      id: `${userUrl}/activities/${Date.now()}`,
      type: 'Fork' as ActivityType,
      actor: userUrl,
      object: originalRepoUrl,
      published: new Date().toISOString(),
    };
  }

  /**
   * Create a Follow activity
   */
  createFollowActivity(follower: string, target: string): ActivityPubActivity {
    return {
      '@context': ACTIVITY_STREAMS_CONTEXT,
      id: `${follower}/activities/follow-${Date.now()}`,
      type: 'Follow',
      actor: follower,
      object: target,
      published: new Date().toISOString(),
    };
  }

  /**
   * Create an Accept activity (response to Follow)
   */
  createAcceptActivity(actor: string, followActivity: ActivityPubActivity): ActivityPubActivity {
    return {
      '@context': ACTIVITY_STREAMS_CONTEXT,
      id: `${actor}/activities/accept-${Date.now()}`,
      type: 'Accept',
      actor: actor,
      object: followActivity.id,
      published: new Date().toISOString(),
    };
  }

  // ============ Inbox/Outbox Handling ============

  /**
   * Handle incoming activity to inbox
   */
  async handleInboxActivity(
    actorId: string,
    activity: ActivityPubActivity
  ): Promise<{ accepted: boolean; response?: ActivityPubActivity }> {
    // Verify HTTP signature (simplified - would need full implementation)
    // In production, verify the HTTP signature header

    console.log(`[Federation] Received ${activity.type} activity from ${activity.actor}`);

    switch (activity.type) {
      case 'Follow':
        return this.handleFollow(actorId, activity);

      case 'Undo':
        return this.handleUndo(actorId, activity);

      case 'Like':
        return this.handleLike(actorId, activity);

      case 'Announce':
        return this.handleAnnounce(actorId, activity);

      case 'Create':
        return this.handleCreate(actorId, activity);

      default:
        console.log(`[Federation] Unhandled activity type: ${activity.type}`);
        return { accepted: false };
    }
  }

  private async handleFollow(
    actorId: string,
    activity: ActivityPubActivity
  ): Promise<{ accepted: boolean; response?: ActivityPubActivity }> {
    const followerActor = activity.actor;
    const targetActor = typeof activity.object === 'string' ? activity.object : activity.object.id;

    // Add to followers
    if (!this.followers.has(actorId)) {
      this.followers.set(actorId, new Set());
    }

    // Fetch follower's inbox
    const remoteActor = await this.fetchRemoteActor(followerActor);
    if (remoteActor) {
      this.followers.get(actorId)?.add(remoteActor.inbox);
    }

    // Create Accept response
    const acceptActivity = this.createAcceptActivity(actorId, activity);

    return { accepted: true, response: acceptActivity };
  }

  private async handleUndo(
    actorId: string,
    activity: ActivityPubActivity
  ): Promise<{ accepted: boolean }> {
    const undoneActivity = activity.object as ActivityPubActivity;

    if (undoneActivity.type === 'Follow') {
      // Remove from followers
      const followers = this.followers.get(actorId);
      if (followers) {
        const remoteActor = await this.fetchRemoteActor(activity.actor);
        if (remoteActor) {
          followers.delete(remoteActor.inbox);
        }
      }
    }

    return { accepted: true };
  }

  private async handleLike(
    actorId: string,
    activity: ActivityPubActivity
  ): Promise<{ accepted: boolean }> {
    // Handle remote star - would update local star count
    console.log(`[Federation] Remote star from ${activity.actor} on ${activity.object}`);
    return { accepted: true };
  }

  private async handleAnnounce(
    actorId: string,
    activity: ActivityPubActivity
  ): Promise<{ accepted: boolean }> {
    // Handle boost/share
    console.log(`[Federation] Remote announce from ${activity.actor}`);
    return { accepted: true };
  }

  private async handleCreate(
    actorId: string,
    activity: ActivityPubActivity
  ): Promise<{ accepted: boolean }> {
    // Handle creation of issues, comments, etc.
    console.log(`[Federation] Remote create from ${activity.actor}`);
    return { accepted: true };
  }

  /**
   * Get outbox activities for an actor
   */
  getOutboxActivities(
    actorId: string,
    options: { page?: number; perPage?: number } = {}
  ): {
    '@context': string;
    id: string;
    type: string;
    totalItems: number;
    orderedItems: ActivityPubActivity[];
  } {
    const page = options.page || 1;
    const perPage = options.perPage || 20;

    // Get activities for this actor from queue
    const actorActivities = this.outboxQueue.filter(a => a.actor === actorId);
    const start = (page - 1) * perPage;
    const items = actorActivities.slice(start, start + perPage);

    return {
      '@context': ACTIVITY_STREAMS_CONTEXT,
      id: `${actorId}/outbox`,
      type: 'OrderedCollection',
      totalItems: actorActivities.length,
      orderedItems: items,
    };
  }

  // ============ Delivery ============

  /**
   * Deliver activity to remote inboxes
   */
  async deliverActivity(activity: ActivityPubActivity): Promise<void> {
    // Add to outbox
    this.outboxQueue.push(activity);

    // Get target inboxes
    const inboxes = new Set<string>();

    // Add followers if sending to followers collection
    const to = Array.isArray(activity.to) ? activity.to : activity.to ? [activity.to] : [];
    const cc = Array.isArray(activity.cc) ? activity.cc : activity.cc ? [activity.cc] : [];

    for (const target of [...to, ...cc]) {
      if (target.endsWith('/followers')) {
        const actorId = target.replace('/followers', '');
        const followers = this.followers.get(actorId);
        if (followers) {
          for (const inbox of followers) {
            inboxes.add(inbox);
          }
        }
      } else if (!target.includes('#Public')) {
        // Direct delivery to actor
        const remoteActor = await this.fetchRemoteActor(target);
        if (remoteActor) {
          inboxes.add(remoteActor.inbox);
        }
      }
    }

    // Deliver to each inbox
    for (const inbox of inboxes) {
      await this.postToInbox(inbox, activity).catch(err => {
        console.error(`[Federation] Failed to deliver to ${inbox}:`, err);
      });
    }
  }

  private async postToInbox(inbox: string, activity: ActivityPubActivity): Promise<void> {
    const body = JSON.stringify(activity);
    const date = new Date().toUTCString();

    // Create HTTP signature
    const signature = this.signRequest('POST', inbox, date, body);

    const response = await fetch(inbox, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/activity+json',
        'Date': date,
        'Signature': signature,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`Inbox delivery failed: ${response.status} ${response.statusText}`);
    }
  }

  // ============ Remote Actor Fetching ============

  /**
   * Fetch remote actor information
   */
  async fetchRemoteActor(actorUrl: string): Promise<RemoteActor | null> {
    // Check cache
    const cached = this.remoteActors.get(actorUrl);
    if (cached && Date.now() - cached.lastFetched < 3600000) {
      return cached;
    }

    const response = await fetch(actorUrl, {
      headers: {
        Accept: 'application/activity+json, application/ld+json',
      },
    }).catch(() => null);

    if (!response?.ok) return null;

    const actor = (await response.json()) as ActivityPubActor;

    const remoteActor: RemoteActor = {
      url: actorUrl,
      inbox: actor.inbox,
      publicKey: actor.publicKey?.publicKeyPem || '',
      lastFetched: Date.now(),
    };

    this.remoteActors.set(actorUrl, remoteActor);
    return remoteActor;
  }

  // ============ HTTP Signatures ============

  private signRequest(method: string, url: string, date: string, body: string): string {
    const parsedUrl = new URL(url);
    const host = parsedUrl.host;
    const path = parsedUrl.pathname;

    const digest = `SHA-256=${createHash('sha256').update(body).digest('base64')}`;

    const signingString = [
      `(request-target): ${method.toLowerCase()} ${path}`,
      `host: ${host}`,
      `date: ${date}`,
      `digest: ${digest}`,
    ].join('\n');

    const sign = createSign('RSA-SHA256');
    sign.update(signingString);
    const signature = sign.sign(this.privateKeyPem, 'base64');

    const keyId = `${this.config.instanceUrl}/actor#main-key`;

    return `keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`;
  }

  /**
   * Verify incoming HTTP signature
   */
  verifySignature(
    headers: Record<string, string>,
    method: string,
    path: string,
    body: string,
    publicKeyPem: string
  ): boolean {
    const signatureHeader = headers['signature'];
    if (!signatureHeader) return false;

    // Parse signature header
    const parts: Record<string, string> = {};
    for (const part of signatureHeader.split(',')) {
      const [key, ...valueParts] = part.split('=');
      parts[key.trim()] = valueParts.join('=').replace(/^"|"$/g, '');
    }

    const signedHeaders = parts['headers']?.split(' ') || [];
    const signingLines: string[] = [];

    for (const header of signedHeaders) {
      if (header === '(request-target)') {
        signingLines.push(`(request-target): ${method.toLowerCase()} ${path}`);
      } else if (header === 'digest') {
        const digest = `SHA-256=${createHash('sha256').update(body).digest('base64')}`;
        signingLines.push(`digest: ${digest}`);
      } else {
        signingLines.push(`${header}: ${headers[header]}`);
      }
    }

    const signingString = signingLines.join('\n');
    const verify = createVerify('RSA-SHA256');
    verify.update(signingString);

    return verify.verify(publicKeyPem, parts['signature'], 'base64');
  }

  // ============ Stats ============

  getStats(): { followers: number; following: number; activities: number } {
    let totalFollowers = 0;
    for (const followers of this.followers.values()) {
      totalFollowers += followers.size;
    }

    return {
      followers: totalFollowers,
      following: this.remoteActors.size,
      activities: this.outboxQueue.length,
    };
  }
}

