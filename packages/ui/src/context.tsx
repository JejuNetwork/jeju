import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";
import {
  createJejuClient,
  type JejuClient,
  type JejuClientConfig,
} from "@jejunetwork/sdk";
import { NetworkSchema, HexSchema, expectValid } from "@jejunetwork/types";
import type { Hex, Account } from "viem";

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

const NetworkProviderPropsSchema = z.object({
  network: NetworkSchema.default("testnet"),
  privateKey: HexSchema.optional(),
  mnemonic: z.string().min(1).optional(),
  smartAccount: z.boolean().default(true),
  rpcUrl: z.string().url().optional(),
});

export interface NetworkProviderProps {
  children: ReactNode;
  network?: z.infer<typeof NetworkSchema>;
  privateKey?: Hex;
  mnemonic?: string;
  account?: Account;
  smartAccount?: boolean;
  rpcUrl?: string;
}

export function NetworkProvider({
  children,
  network = "testnet",
  privateKey,
  mnemonic,
  account,
  smartAccount = true,
  rpcUrl,
}: NetworkProviderProps): React.JSX.Element {
  const [client, setClient] = useState<JejuClient | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!privateKey && !mnemonic && !account) {
      setIsLoading(false);
      return;
    }

    const validatedConfig = expectValid(
      NetworkProviderPropsSchema,
      { network, privateKey, mnemonic, smartAccount, rpcUrl },
      "NetworkProvider config",
    );

    const init = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      const config: JejuClientConfig = {
        network: validatedConfig.network,
        privateKey: validatedConfig.privateKey,
        mnemonic: validatedConfig.mnemonic,
        account,
        smartAccount: validatedConfig.smartAccount,
        rpcUrl: validatedConfig.rpcUrl,
      };

      const jejuClient = await createJejuClient(config);
      setClient(jejuClient);
      setIsLoading(false);
    };

    init().catch((err: unknown) => {
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsLoading(false);
    });
  }, [network, privateKey, mnemonic, account, smartAccount, rpcUrl]);

  return (
    <NetworkContext.Provider value={{ client, isLoading, error }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetworkContext(): NetworkContextValue {
  return useContext(NetworkContext);
}
