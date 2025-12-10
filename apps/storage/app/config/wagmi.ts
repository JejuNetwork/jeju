import { http, createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { jeju, RPC_URL } from './index';

export const wagmiConfig = createConfig({
  chains: [jeju],
  connectors: [injected()],
  transports: {
    [jeju.id]: http(RPC_URL, {
      batch: true,
      retryCount: 3,
      retryDelay: 1000,
    }),
  },
  ssr: true,
});
