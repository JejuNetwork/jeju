/**
 * useMFA Hook
 * 
 * Provides MFA setup and verification functionality.
 */

import { useState, useCallback, useEffect } from 'react';
import { MFAMethod, type MFAStatus } from '../../mfa/index.js';
import { useOAuth3 } from '../provider.js';
import { getEndpointWithDevFallback, extractError } from '../../validation.js';

export interface UseMFAOptions {
  onSetupComplete?: (method: MFAMethod) => void;
  onVerifySuccess?: () => void;
  onError?: (error: Error) => void;
}

export interface UseMFAReturn {
  // Status
  mfaStatus: MFAStatus | null;
  isLoading: boolean;
  error: string | null;
  
  // TOTP
  setupTOTP: () => Promise<{ secret: string; uri: string; qrCode: string } | null>;
  verifyTOTP: (code: string) => Promise<boolean>;
  disableTOTP: () => Promise<boolean>;
  
  // Passkeys
  setupPasskey: (deviceName: string) => Promise<boolean>;
  verifyPasskey: () => Promise<boolean>;
  listPasskeys: () => Promise<Array<{ id: string; deviceName: string; createdAt: number }>>;
  removePasskey: (id: string) => Promise<boolean>;
  
  // Backup Codes
  generateBackupCodes: () => Promise<string[] | null>;
  verifyBackupCode: (code: string) => Promise<boolean>;
  
  // Generic
  verifyMFA: (method: MFAMethod, code: string) => Promise<boolean>;
  refreshStatus: () => Promise<void>;
}

export function useMFA(options: UseMFAOptions = {}): UseMFAReturn {
  const { client, session } = useOAuth3();
  const [mfaStatus, setMFAStatus] = useState<MFAStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch MFA status on mount and when session changes
  useEffect(() => {
    if (session) {
      refreshStatus();
    }
  }, [session?.sessionId]);

  const refreshStatus = useCallback(async () => {
    if (!session) return;
    
    setIsLoading(true);
    
    const node = client.getCurrentNode();
    const url = getEndpointWithDevFallback(node);
    const response = await fetch(`${url}/mfa/status`, {
      headers: { 'x-session-id': session.sessionId },
    });

    setIsLoading(false);

    if (response.ok) {
      const status = await response.json() as MFAStatus;
      setMFAStatus(status);
    }
  }, [client, session]);

  const setupTOTP = useCallback(async (): Promise<{ secret: string; uri: string; qrCode: string } | null> => {
    if (!session) return null;
    
    setIsLoading(true);
    setError(null);

    const node = client.getCurrentNode();
    const url = getEndpointWithDevFallback(node);
    const response = await fetch(`${url}/mfa/totp/setup`, {
      method: 'POST',
      headers: { 'x-session-id': session.sessionId },
    });

    setIsLoading(false);

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = extractError(errorData);
      setError(errorMessage);
      options.onError?.(new Error(errorMessage));
      return null;
    }

    return response.json() as Promise<{ secret: string; uri: string; qrCode: string }>;
  }, [client, session, options]);

  const verifyTOTP = useCallback(async (code: string): Promise<boolean> => {
    if (!session) return false;
    
    setIsLoading(true);
    setError(null);

    const node = client.getCurrentNode();
    const url = getEndpointWithDevFallback(node);
    const response = await fetch(`${url}/mfa/totp/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': session.sessionId,
      },
      body: JSON.stringify({ code, enable: true }),
    });

    setIsLoading(false);

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = extractError(errorData);
      setError(errorMessage);
      options.onError?.(new Error(errorMessage));
      return false;
    }

    options.onSetupComplete?.(MFAMethod.TOTP);
    await refreshStatus();
    return true;
  }, [client, session, options, refreshStatus]);

  const disableTOTP = useCallback(async (): Promise<boolean> => {
    if (!session) return false;
    
    setIsLoading(true);

    const node = client.getCurrentNode();
    const url = getEndpointWithDevFallback(node);
    const response = await fetch(`${url}/mfa/totp`, {
      method: 'DELETE',
      headers: { 'x-session-id': session.sessionId },
    });

    setIsLoading(false);

    if (response.ok) {
      await refreshStatus();
      return true;
    }

    return false;
  }, [client, session, refreshStatus]);

  const setupPasskey = useCallback(async (deviceName: string): Promise<boolean> => {
    if (!session || typeof window === 'undefined') return false;
    
    setIsLoading(true);
    setError(null);

    const node = client.getCurrentNode();
    const url = getEndpointWithDevFallback(node);

    // Get registration options
    const optionsResponse = await fetch(`${url}/mfa/passkey/register/options`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': session.sessionId,
      },
      body: JSON.stringify({ deviceName }),
    });

    if (!optionsResponse.ok) {
      setIsLoading(false);
      setError('Failed to get registration options');
      return false;
    }

    const { challengeId, publicKey } = await optionsResponse.json() as {
      challengeId: string;
      publicKey: PublicKeyCredentialCreationOptions;
    };

    // Create credential using WebAuthn
    const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential;

    // Send credential to server
    const verifyResponse = await fetch(`${url}/mfa/passkey/register/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': session.sessionId,
      },
      body: JSON.stringify({
        challengeId,
        credential: {
          id: credential.id,
          rawId: arrayBufferToBase64(credential.rawId),
          response: {
            clientDataJSON: arrayBufferToBase64((credential.response as AuthenticatorAttestationResponse).clientDataJSON),
            attestationObject: arrayBufferToBase64((credential.response as AuthenticatorAttestationResponse).attestationObject),
          },
          type: credential.type,
        },
        deviceName,
      }),
    });

    setIsLoading(false);

    if (!verifyResponse.ok) {
      const errorData = await verifyResponse.json();
      setError(extractError(errorData));
      return false;
    }

    options.onSetupComplete?.(MFAMethod.PASSKEY);
    await refreshStatus();
    return true;
  }, [client, session, options, refreshStatus]);

  const verifyPasskey = useCallback(async (): Promise<boolean> => {
    if (!session || typeof window === 'undefined') return false;
    
    setIsLoading(true);
    setError(null);

    const node = client.getCurrentNode();
    const url = getEndpointWithDevFallback(node);

    // Get authentication options
    const optionsResponse = await fetch(`${url}/mfa/passkey/authenticate/options`, {
      method: 'POST',
      headers: { 'x-session-id': session.sessionId },
    });

    if (!optionsResponse.ok) {
      setIsLoading(false);
      setError('Failed to get authentication options');
      return false;
    }

    const { challengeId, publicKey } = await optionsResponse.json() as {
      challengeId: string;
      publicKey: PublicKeyCredentialRequestOptions;
    };

    // Get credential using WebAuthn
    const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential;

    // Verify credential
    const verifyResponse = await fetch(`${url}/mfa/passkey/authenticate/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': session.sessionId,
      },
      body: JSON.stringify({
        challengeId,
        credential: {
          id: credential.id,
          rawId: arrayBufferToBase64(credential.rawId),
          response: {
            clientDataJSON: arrayBufferToBase64((credential.response as AuthenticatorAssertionResponse).clientDataJSON),
            authenticatorData: arrayBufferToBase64((credential.response as AuthenticatorAssertionResponse).authenticatorData),
            signature: arrayBufferToBase64((credential.response as AuthenticatorAssertionResponse).signature),
            userHandle: (credential.response as AuthenticatorAssertionResponse).userHandle
              ? arrayBufferToBase64((credential.response as AuthenticatorAssertionResponse).userHandle!)
              : undefined,
          },
          type: credential.type,
        },
      }),
    });

    setIsLoading(false);

    if (!verifyResponse.ok) {
      const errorData = await verifyResponse.json();
      setError(extractError(errorData));
      return false;
    }

    options.onVerifySuccess?.();
    return true;
  }, [client, session, options]);

  const listPasskeys = useCallback(async (): Promise<Array<{ id: string; deviceName: string; createdAt: number }>> => {
    if (!session) return [];
    
    const node = client.getCurrentNode();
    const url = getEndpointWithDevFallback(node);
    const response = await fetch(`${url}/mfa/passkey/list`, {
      headers: { 'x-session-id': session.sessionId },
    });

    if (!response.ok) return [];

    return response.json() as Promise<Array<{ id: string; deviceName: string; createdAt: number }>>;
  }, [client, session]);

  const removePasskey = useCallback(async (id: string): Promise<boolean> => {
    if (!session) return false;
    
    const node = client.getCurrentNode();
    const url = getEndpointWithDevFallback(node);
    const response = await fetch(`${url}/mfa/passkey/${id}`, {
      method: 'DELETE',
      headers: { 'x-session-id': session.sessionId },
    });

    if (response.ok) {
      await refreshStatus();
      return true;
    }

    return false;
  }, [client, session, refreshStatus]);

  const generateBackupCodes = useCallback(async (): Promise<string[] | null> => {
    if (!session) return null;
    
    setIsLoading(true);

    const node = client.getCurrentNode();
    const url = getEndpointWithDevFallback(node);
    const response = await fetch(`${url}/mfa/backup-codes/generate`, {
      method: 'POST',
      headers: { 'x-session-id': session.sessionId },
    });

    setIsLoading(false);

    if (!response.ok) {
      setError('Failed to generate backup codes');
      return null;
    }

    const { codes } = await response.json() as { codes: string[] };
    await refreshStatus();
    return codes;
  }, [client, session, refreshStatus]);

  const verifyBackupCode = useCallback(async (code: string): Promise<boolean> => {
    if (!session) return false;
    
    setIsLoading(true);

    const node = client.getCurrentNode();
    const url = getEndpointWithDevFallback(node);
    const response = await fetch(`${url}/mfa/backup-codes/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': session.sessionId,
      },
      body: JSON.stringify({ code }),
    });

    setIsLoading(false);

    if (!response.ok) {
      setError('Invalid backup code');
      return false;
    }

    options.onVerifySuccess?.();
    await refreshStatus();
    return true;
  }, [client, session, options, refreshStatus]);

  const verifyMFA = useCallback(async (method: MFAMethod, code: string): Promise<boolean> => {
    switch (method) {
      case MFAMethod.TOTP:
        return verifyTOTP(code);
      case MFAMethod.BACKUP_CODE:
        return verifyBackupCode(code);
      case MFAMethod.PASSKEY:
        return verifyPasskey();
      default:
        return false;
    }
  }, [verifyTOTP, verifyBackupCode, verifyPasskey]);

  return {
    mfaStatus,
    isLoading,
    error,
    setupTOTP,
    verifyTOTP,
    disableTOTP,
    setupPasskey,
    verifyPasskey,
    listPasskeys,
    removePasskey,
    generateBackupCodes,
    verifyBackupCode,
    verifyMFA,
    refreshStatus,
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
