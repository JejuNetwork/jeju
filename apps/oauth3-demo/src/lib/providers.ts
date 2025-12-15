/**
 * OAuth Provider Configurations
 * 
 * Comprehensive support for all major OAuth providers:
 * - Discord, Twitter/X, Google, Farcaster
 * - Facebook, Instagram, LinkedIn, TikTok
 * - Slack, GitHub, Notion
 */

export type OAuthProvider = 
  | 'wallet' 
  | 'discord' 
  | 'twitter' 
  | 'google' 
  | 'farcaster'
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'tiktok'
  | 'slack'
  | 'github'
  | 'notion';

export interface ProviderConfig {
  id: OAuthProvider;
  name: string;
  icon: string;
  color: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  pkce: boolean;
  clientIdEnv: string;
  clientSecretEnv: string;
}

export const PROVIDER_CONFIGS: Record<OAuthProvider, ProviderConfig | null> = {
  wallet: null, // SIWE, not OAuth

  discord: {
    id: 'discord',
    name: 'Discord',
    icon: 'discord',
    color: '#5865F2',
    authUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scopes: ['identify', 'email'],
    pkce: false,
    clientIdEnv: 'OAUTH_DISCORD_CLIENT_ID',
    clientSecretEnv: 'OAUTH_DISCORD_CLIENT_SECRET',
  },

  twitter: {
    id: 'twitter',
    name: 'X (Twitter)',
    icon: 'twitter',
    color: '#000000',
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    userInfoUrl: 'https://api.twitter.com/2/users/me',
    scopes: ['tweet.read', 'users.read', 'offline.access'],
    pkce: true,
    clientIdEnv: 'OAUTH_TWITTER_CLIENT_ID',
    clientSecretEnv: 'OAUTH_TWITTER_CLIENT_SECRET',
  },

  google: {
    id: 'google',
    name: 'Google',
    icon: 'google',
    color: '#4285F4',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scopes: ['openid', 'email', 'profile'],
    pkce: true,
    clientIdEnv: 'OAUTH_GOOGLE_CLIENT_ID',
    clientSecretEnv: 'OAUTH_GOOGLE_CLIENT_SECRET',
  },

  farcaster: null, // Uses Farcaster Sign-In, not standard OAuth

  facebook: {
    id: 'facebook',
    name: 'Facebook',
    icon: 'facebook',
    color: '#1877F2',
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/v19.0/me',
    scopes: ['email', 'public_profile'],
    pkce: false,
    clientIdEnv: 'OAUTH_FACEBOOK_APP_ID',
    clientSecretEnv: 'OAUTH_FACEBOOK_APP_SECRET',
  },

  instagram: {
    id: 'instagram',
    name: 'Instagram',
    icon: 'instagram',
    color: '#E4405F',
    authUrl: 'https://api.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    userInfoUrl: 'https://graph.instagram.com/me',
    scopes: ['user_profile', 'user_media'],
    pkce: false,
    clientIdEnv: 'OAUTH_INSTAGRAM_CLIENT_ID',
    clientSecretEnv: 'OAUTH_INSTAGRAM_CLIENT_SECRET',
  },

  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    icon: 'linkedin',
    color: '#0A66C2',
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    userInfoUrl: 'https://api.linkedin.com/v2/me',
    scopes: ['openid', 'profile', 'email'],
    pkce: false,
    clientIdEnv: 'OAUTH_LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'OAUTH_LINKEDIN_CLIENT_SECRET',
  },

  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    icon: 'tiktok',
    color: '#000000',
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    userInfoUrl: 'https://open.tiktokapis.com/v2/user/info/',
    scopes: ['user.info.basic'],
    pkce: true,
    clientIdEnv: 'OAUTH_TIKTOK_CLIENT_KEY',
    clientSecretEnv: 'OAUTH_TIKTOK_CLIENT_SECRET',
  },

  slack: {
    id: 'slack',
    name: 'Slack',
    icon: 'slack',
    color: '#4A154B',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    userInfoUrl: 'https://slack.com/api/users.identity',
    scopes: ['identity.basic', 'identity.email', 'identity.avatar'],
    pkce: false,
    clientIdEnv: 'OAUTH_SLACK_CLIENT_ID',
    clientSecretEnv: 'OAUTH_SLACK_CLIENT_SECRET',
  },

  github: {
    id: 'github',
    name: 'GitHub',
    icon: 'github',
    color: '#181717',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
    pkce: false,
    clientIdEnv: 'OAUTH_GITHUB_CLIENT_ID',
    clientSecretEnv: 'OAUTH_GITHUB_CLIENT_SECRET',
  },

  notion: {
    id: 'notion',
    name: 'Notion',
    icon: 'notion',
    color: '#000000',
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    userInfoUrl: 'https://api.notion.com/v1/users/me',
    scopes: [],
    pkce: false,
    clientIdEnv: 'OAUTH_NOTION_CLIENT_ID',
    clientSecretEnv: 'OAUTH_NOTION_CLIENT_SECRET',
  },
};

export function getEnabledProviders(): OAuthProvider[] {
  const enabled: OAuthProvider[] = ['wallet', 'farcaster'];
  
  for (const [id, config] of Object.entries(PROVIDER_CONFIGS)) {
    if (config && process.env[config.clientIdEnv]) {
      enabled.push(id as OAuthProvider);
    }
  }
  
  return enabled;
}

export function getProviderConfig(provider: OAuthProvider): ProviderConfig | null {
  return PROVIDER_CONFIGS[provider];
}
