/**
 * Social OAuth Providers - Google, Apple, Twitter, GitHub, Discord
 * 
 * Each provider handles OAuth flow initiation and callback verification.
 * Token exchange and profile fetching happens in the TEE agent.
 */

import { keccak256, toBytes, toHex, type Address, type Hex } from 'viem';
import { AuthProvider } from '../types.js';

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

export interface OAuthProfile {
  id: string;
  email?: string;
  name?: string;
  avatar?: string;
  handle?: string;
  verified: boolean;
  raw: Record<string, unknown>;
}

abstract class OAuthProvider {
  protected config: OAuthConfig;
  protected provider: AuthProvider;

  constructor(provider: AuthProvider, config: OAuthConfig) {
    this.provider = provider;
    this.config = config;
  }

  abstract getAuthorizationUrl(state: OAuthState): string;
  abstract exchangeCode(code: string, state: OAuthState): Promise<OAuthToken>;
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

  protected async fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
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

  async exchangeCode(code: string, state: OAuthState): Promise<OAuthToken> {
    const response = await this.fetchJson<{
      access_token: string;
      refresh_token?: string;
      token_type: string;
      expires_in: number;
      scope: string;
      id_token?: string;
    }>(GoogleProvider.TOKEN_URL, {
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

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      tokenType: response.token_type,
      expiresIn: response.expires_in,
      scope: response.scope,
      idToken: response.id_token,
    };
  }

  async getProfile(token: OAuthToken): Promise<OAuthProfile> {
    const response = await this.fetchJson<{
      id: string;
      email: string;
      name: string;
      picture: string;
      verified_email: boolean;
    }>(GoogleProvider.PROFILE_URL, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });

    return {
      id: response.id,
      email: response.email,
      name: response.name,
      avatar: response.picture,
      verified: response.verified_email,
      raw: response as unknown as Record<string, unknown>,
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

  async exchangeCode(code: string, _state: OAuthState): Promise<OAuthToken> {
    const response = await this.fetchJson<{
      access_token: string;
      refresh_token?: string;
      token_type: string;
      expires_in: number;
      id_token: string;
    }>(AppleProvider.TOKEN_URL, {
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
    // Apple ID token contains the profile info
    if (!token.idToken) throw new Error('No ID token from Apple');
    
    const payload = JSON.parse(atob(token.idToken.split('.')[1])) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
    };

    return {
      id: payload.sub,
      email: payload.email,
      verified: payload.email_verified ?? false,
      raw: payload as unknown as Record<string, unknown>,
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
    // Generate PKCE code verifier and challenge
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

  async exchangeCode(code: string, state: OAuthState): Promise<OAuthToken> {
    if (!state.codeVerifier) throw new Error('No PKCE code verifier');

    const response = await this.fetchJson<{
      access_token: string;
      refresh_token?: string;
      token_type: string;
      expires_in: number;
      scope: string;
    }>(TwitterProvider.TOKEN_URL, {
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

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      tokenType: response.token_type,
      expiresIn: response.expires_in,
      scope: response.scope,
    };
  }

  async getProfile(token: OAuthToken): Promise<OAuthProfile> {
    const response = await this.fetchJson<{
      data: {
        id: string;
        name: string;
        username: string;
        profile_image_url: string;
        verified: boolean;
      };
    }>(`${TwitterProvider.PROFILE_URL}?user.fields=profile_image_url,verified`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });

    return {
      id: response.data.id,
      name: response.data.name,
      handle: `@${response.data.username}`,
      avatar: response.data.profile_image_url,
      verified: response.data.verified,
      raw: response.data as unknown as Record<string, unknown>,
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

  async exchangeCode(code: string, _state: OAuthState): Promise<OAuthToken> {
    const response = await this.fetchJson<{
      access_token: string;
      token_type: string;
      scope: string;
    }>(GitHubProvider.TOKEN_URL, {
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

    return {
      accessToken: response.access_token,
      tokenType: response.token_type,
      expiresIn: 0, // GitHub tokens don't expire
      scope: response.scope,
    };
  }

  async getProfile(token: OAuthToken): Promise<OAuthProfile> {
    const response = await this.fetchJson<{
      id: number;
      login: string;
      name: string;
      email: string;
      avatar_url: string;
    }>(GitHubProvider.PROFILE_URL, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    });

    return {
      id: response.id.toString(),
      email: response.email,
      name: response.name,
      handle: `@${response.login}`,
      avatar: response.avatar_url,
      verified: true, // GitHub emails are verified
      raw: response as unknown as Record<string, unknown>,
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

  async exchangeCode(code: string, _state: OAuthState): Promise<OAuthToken> {
    const response = await this.fetchJson<{
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    }>(DiscordProvider.TOKEN_URL, {
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

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      tokenType: response.token_type,
      expiresIn: response.expires_in,
      scope: response.scope,
    };
  }

  async getProfile(token: OAuthToken): Promise<OAuthProfile> {
    const response = await this.fetchJson<{
      id: string;
      username: string;
      global_name: string;
      email: string;
      avatar: string;
      verified: boolean;
    }>(DiscordProvider.PROFILE_URL, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });

    const avatarUrl = response.avatar
      ? `https://cdn.discordapp.com/avatars/${response.id}/${response.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(response.id) % 5}.png`;

    return {
      id: response.id,
      email: response.email,
      name: response.global_name || response.username,
      handle: `@${response.username}`,
      avatar: avatarUrl,
      verified: response.verified,
      raw: response as unknown as Record<string, unknown>,
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

