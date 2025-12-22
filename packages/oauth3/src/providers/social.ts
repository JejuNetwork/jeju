/**
 * Social OAuth Providers - Google, Apple, Twitter, GitHub, Discord
 * 
 * Each provider handles OAuth flow initiation and callback verification.
 * Token exchange and profile fetching happens in the TEE agent.
 */

import { z } from 'zod';
import { keccak256, toHex, type Hex } from 'viem';
import { AuthProvider } from '../types.js';
import {
  OAuthTokenResponseSchema,
  GoogleUserInfoSchema,
  GitHubUserSchema,
  TwitterUserSchema,
  DiscordUserSchema,
  validateResponse,
} from '../validation.js';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface OAuthState {
  state: string;
  nonce: string;
  provider: AuthProvider;
  appId: Hex;
  createdAt: number;
  codeVerifier?: string;
}

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: number;
  scope: string;
  idToken?: string;
}

interface GoogleProfileRaw {
  id: string;
  email: string;
  name: string;
  picture: string;
  verified_email: boolean;
}

interface GitHubProfileRaw {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

interface TwitterProfileRaw {
  id: string;
  username: string;
  name: string;
  profile_image_url?: string;
  verified?: boolean;
}

interface DiscordProfileRaw {
  id: string;
  username: string;
  global_name: string | null;
  email?: string;
  avatar: string | null;
  verified?: boolean;
}

interface AppleIdTokenPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
}

type OAuthProfileRaw = GoogleProfileRaw | GitHubProfileRaw | TwitterProfileRaw | DiscordProfileRaw | AppleIdTokenPayload;

export interface OAuthProfile {
  id: string;
  email?: string;
  name?: string;
  avatar?: string;
  handle?: string;
  verified: boolean;
  raw: OAuthProfileRaw;
}

abstract class OAuthProvider {
  protected config: OAuthConfig;
  protected provider: AuthProvider;

  constructor(provider: AuthProvider, config: OAuthConfig) {
    this.provider = provider;
    this.config = config;
  }

  abstract getAuthorizationUrl(state: OAuthState): string;
  abstract exchangeCode(code: string, state?: OAuthState): Promise<OAuthToken>;
  abstract getProfile(token: OAuthToken): Promise<OAuthProfile>;

  protected generateState(appId: Hex): OAuthState {
    const stateBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
    return {
      state: toHex(stateBytes).slice(2),
      nonce: toHex(nonceBytes).slice(2),
      provider: this.provider,
      appId,
      createdAt: Date.now(),
    };
  }

  protected async fetchJson<T = unknown>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OAuth request failed: ${response.status} - ${text}`);
    }
    return response.json() as Promise<T>;
  }
}

export class GoogleProvider extends OAuthProvider {
  private static AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  private static TOKEN_URL = 'https://oauth2.googleapis.com/token';
  private static PROFILE_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

  constructor(config: OAuthConfig) {
    super(AuthProvider.GOOGLE, {
      ...config,
      scopes: config.scopes.length > 0 ? config.scopes : ['openid', 'email', 'profile'],
    });
  }

  getAuthorizationUrl(state: OAuthState): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state: state.state,
      nonce: state.nonce,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${GoogleProvider.AUTH_URL}?${params}`;
  }

  async exchangeCode(code: string): Promise<OAuthToken> {
    const rawResponse = await this.fetchJson(GoogleProvider.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const response = validateResponse(OAuthTokenResponseSchema, rawResponse, 'Google token response');

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      tokenType: response.token_type,
      expiresIn: response.expires_in,
      scope: response.scope ?? '',
      idToken: response.id_token,
    };
  }

  async getProfile(token: OAuthToken): Promise<OAuthProfile> {
    const rawResponse = await this.fetchJson(GoogleProvider.PROFILE_URL, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });

    const response = validateResponse(GoogleUserInfoSchema, rawResponse, 'Google user info');

    return {
      id: response.id ?? response.sub ?? '',
      email: response.email,
      name: response.name,
      avatar: response.picture,
      verified: response.verified_email ?? response.email_verified ?? false,
      raw: { id: response.id ?? response.sub ?? '', email: response.email, name: response.name, picture: response.picture, verified_email: response.verified_email ?? response.email_verified ?? false },
    };
  }
}

export class AppleProvider extends OAuthProvider {
  private static AUTH_URL = 'https://appleid.apple.com/auth/authorize';
  private static TOKEN_URL = 'https://appleid.apple.com/auth/token';

  constructor(config: OAuthConfig) {
    super(AuthProvider.APPLE, {
      ...config,
      scopes: config.scopes.length > 0 ? config.scopes : ['name', 'email'],
    });
  }

  getAuthorizationUrl(state: OAuthState): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state: state.state,
      response_mode: 'form_post',
    });
    return `${AppleProvider.AUTH_URL}?${params}`;
  }

  async exchangeCode(code: string): Promise<OAuthToken> {
    const rawResponse = await this.fetchJson(AppleProvider.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const response = validateResponse(OAuthTokenResponseSchema, rawResponse, 'Apple token response');

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      tokenType: response.token_type,
      expiresIn: response.expires_in,
      scope: this.config.scopes.join(' '),
      idToken: response.id_token,
    };
  }

  async getProfile(token: OAuthToken): Promise<OAuthProfile> {
    if (!token.idToken) throw new Error('No ID token from Apple');
    
    const payloadStr = atob(token.idToken.split('.')[1]);
    const rawPayload = JSON.parse(payloadStr);
    
    const AppleIdTokenSchema = z.object({
      sub: z.string(),
      email: z.string().optional(),
      email_verified: z.union([z.boolean(), z.string()]).optional(),
    });
    
    const payload = validateResponse(AppleIdTokenSchema, rawPayload, 'Apple ID token');

    return {
      id: payload.sub,
      email: payload.email,
      verified: payload.email_verified === true || payload.email_verified === 'true',
      raw: { sub: payload.sub, email: payload.email, email_verified: payload.email_verified === true || payload.email_verified === 'true' },
    };
  }
}

export class TwitterProvider extends OAuthProvider {
  private static AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
  private static TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
  private static PROFILE_URL = 'https://api.twitter.com/2/users/me';

  constructor(config: OAuthConfig) {
    super(AuthProvider.TWITTER, {
      ...config,
      scopes: config.scopes.length > 0 ? config.scopes : ['users.read', 'tweet.read'],
    });
  }

  getAuthorizationUrl(state: OAuthState): string {
    const codeVerifier = toHex(crypto.getRandomValues(new Uint8Array(32))).slice(2);
    state.codeVerifier = codeVerifier;
    
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state: state.state,
      code_challenge: keccak256(data).slice(2, 66),
      code_challenge_method: 'S256',
    });
    return `${TwitterProvider.AUTH_URL}?${params}`;
  }

  async exchangeCode(code: string, state?: OAuthState): Promise<OAuthToken> {
    if (!state?.codeVerifier) throw new Error('No PKCE code verifier');

    const rawResponse = await this.fetchJson(TwitterProvider.TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${this.config.clientId}:${this.config.clientSecret}`)}`,
      },
      body: new URLSearchParams({
        code,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: state.codeVerifier,
      }),
    });

    const response = validateResponse(OAuthTokenResponseSchema, rawResponse, 'Twitter token response');

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      tokenType: response.token_type,
      expiresIn: response.expires_in,
      scope: response.scope ?? '',
    };
  }

  async getProfile(token: OAuthToken): Promise<OAuthProfile> {
    const rawResponse = await this.fetchJson(`${TwitterProvider.PROFILE_URL}?user.fields=profile_image_url,verified`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });

    const response = validateResponse(TwitterUserSchema, rawResponse, 'Twitter user info');

    return {
      id: response.data.id,
      name: response.data.name,
      handle: `@${response.data.username}`,
      avatar: response.data.profile_image_url,
      verified: response.data.verified ?? false,
      raw: { id: response.data.id, username: response.data.username, name: response.data.name, profile_image_url: response.data.profile_image_url, verified: response.data.verified },
    };
  }
}

export class GitHubProvider extends OAuthProvider {
  private static AUTH_URL = 'https://github.com/login/oauth/authorize';
  private static TOKEN_URL = 'https://github.com/login/oauth/access_token';
  private static PROFILE_URL = 'https://api.github.com/user';

  constructor(config: OAuthConfig) {
    super(AuthProvider.GITHUB, {
      ...config,
      scopes: config.scopes.length > 0 ? config.scopes : ['read:user', 'user:email'],
    });
  }

  getAuthorizationUrl(state: OAuthState): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      state: state.state,
    });
    return `${GitHubProvider.AUTH_URL}?${params}`;
  }

  async exchangeCode(code: string): Promise<OAuthToken> {
    const GitHubTokenSchema = z.object({
      access_token: z.string(),
      token_type: z.string(),
      scope: z.string(),
    });

    const rawResponse = await this.fetchJson(GitHubProvider.TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
      }),
    });

    const response = validateResponse(GitHubTokenSchema, rawResponse, 'GitHub token response');

    return {
      accessToken: response.access_token,
      tokenType: response.token_type,
      expiresIn: 0,
      scope: response.scope,
    };
  }

  async getProfile(token: OAuthToken): Promise<OAuthProfile> {
    const rawResponse = await this.fetchJson(GitHubProvider.PROFILE_URL, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    });

    const response = validateResponse(GitHubUserSchema, rawResponse, 'GitHub user info');

    return {
      id: response.id.toString(),
      email: response.email ?? undefined,
      name: response.name ?? undefined,
      handle: `@${response.login}`,
      avatar: response.avatar_url,
      verified: true,
      raw: { id: response.id, login: response.login, name: response.name, email: response.email, avatar_url: response.avatar_url },
    };
  }
}

export class DiscordProvider extends OAuthProvider {
  private static AUTH_URL = 'https://discord.com/api/oauth2/authorize';
  private static TOKEN_URL = 'https://discord.com/api/oauth2/token';
  private static PROFILE_URL = 'https://discord.com/api/users/@me';

  constructor(config: OAuthConfig) {
    super(AuthProvider.DISCORD, {
      ...config,
      scopes: config.scopes.length > 0 ? config.scopes : ['identify', 'email'],
    });
  }

  getAuthorizationUrl(state: OAuthState): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state: state.state,
    });
    return `${DiscordProvider.AUTH_URL}?${params}`;
  }

  async exchangeCode(code: string): Promise<OAuthToken> {
    const rawResponse = await this.fetchJson(DiscordProvider.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const response = validateResponse(OAuthTokenResponseSchema, rawResponse, 'Discord token response');

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      tokenType: response.token_type,
      expiresIn: response.expires_in,
      scope: response.scope ?? '',
    };
  }

  async getProfile(token: OAuthToken): Promise<OAuthProfile> {
    const rawResponse = await this.fetchJson(DiscordProvider.PROFILE_URL, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });

    const response = validateResponse(DiscordUserSchema, rawResponse, 'Discord user info');

    const avatarUrl = response.avatar
      ? `https://cdn.discordapp.com/avatars/${response.id}/${response.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(response.id) % 5}.png`;

    return {
      id: response.id,
      email: response.email,
      name: response.global_name ?? response.username,
      handle: `@${response.username}`,
      avatar: avatarUrl,
      verified: response.verified ?? false,
      raw: { id: response.id, username: response.username, global_name: response.global_name, email: response.email, avatar: response.avatar, verified: response.verified },
    };
  }
}

// Provider factory
export function createOAuthProvider(provider: AuthProvider, config: OAuthConfig): OAuthProvider {
  switch (provider) {
    case AuthProvider.GOOGLE: return new GoogleProvider(config);
    case AuthProvider.APPLE: return new AppleProvider(config);
    case AuthProvider.TWITTER: return new TwitterProvider(config);
    case AuthProvider.GITHUB: return new GitHubProvider(config);
    case AuthProvider.DISCORD: return new DiscordProvider(config);
    default: throw new Error(`Unsupported OAuth provider: ${provider}`);
  }
}

// Re-export types
export type { OAuthProvider };

