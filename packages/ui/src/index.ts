/**
 * @jejunetwork/ui - React hooks for network SDK
 *
 * @example
 * ```tsx
 * import { NetworkProvider, useJeju, useCompute, useDefi } from '@jejunetwork/ui';
 *
 * function App() {
 *   return (
 *     <NetworkProvider network="testnet" privateKey="0x...">
 *       <MyComponent />
 *     </NetworkProvider>
 *   );
 * }
 *
 * function MyComponent() {
 *   const { address, balance } = useJeju();
 *   const { providers, createRental } = useCompute();
 *   const { swap, pools } = useDefi();
 *   // ...
 * }
 * ```
 */

export {
  NetworkProvider,
  useNetworkContext,
  type NetworkContextValue,
} from "./context";

// Core hooks
export { useJeju } from "./hooks/useJeju";
export { useBalance } from "./hooks/useBalance";

// Module hooks
export { useCompute } from "./hooks/useCompute";
export { useStorage } from "./hooks/useStorage";
export { useDefi } from "./hooks/useDefi";
export { useGovernance } from "./hooks/useGovernance";
export { useNames } from "./hooks/useNames";
export { useIdentity } from "./hooks/useIdentity";
export { useCrossChain } from "./hooks/useCrossChain";
export { usePayments } from "./hooks/usePayments";
