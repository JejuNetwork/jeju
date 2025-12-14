/**
 * Network React Context
 */

import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createJejuClient, type JejuClient, type JejuClientConfig } from '@jejunetwork/sdk';
import type { NetworkType } from '@jejunetwork/types';
import type { Hex, Account } from 'viem';

export interface NetworkContextValue {
  client: JejuClient | null;
  isLoading: boolean;
  error: Error | null;
}

const NetworkContext = createContext<NetworkContextValue>({
  client: null,
  isLoading: true,
  error: null,
});

export interface NetworkProviderProps {
  children: ReactNode;
  network?: NetworkType;
  privateKey?: Hex;
  mnemonic?: string;
  account?: Account;
  smartAccount?: boolean;
  rpcUrl?: string;
}

export function NetworkProvider({
  children,
  network = 'testnet',
  privateKey,
  mnemonic,
  account,
  smartAccount = true,
  rpcUrl,
}: NetworkProviderProps) {
  const [client, setClient] = useState<JejuClient | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!privateKey && !mnemonic && !account) {
      setIsLoading(false);
      return;
    }

    const init = async () => {
      setIsLoading(true);
      setError(null);

      const config: JejuClientConfig = {
        network,
        privateKey,
        mnemonic,
        account,
        smartAccount,
        rpcUrl,
      };

      const jejuClient = await createJejuClient(config);
      setClient(jejuClient);
      setIsLoading(false);
    };

    init().catch((err) => {
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsLoading(false);
    });
  }, [network, privateKey, mnemonic, smartAccount, rpcUrl]);

  return (
    <NetworkContext.Provider value={{ client, isLoading, error }}>{children}</NetworkContext.Provider>
  );
}

export function useNetworkContext(): NetworkContextValue {
  return useContext(NetworkContext);
}

