/**
 * Infrastructure Module
 */

export {
  BlockchainClient,
  type BlockchainConfig,
  type ChainId,
  type GameState,
  type OperatorInfo,
} from './blockchain-client.js';

export {
  type BootstrapConfig,
  type BootstrappedGame,
  bootstrap,
  type GameStatus,
} from './bootstrap.js';

export {
  TEEProviderType,
  TEEHardwareType,
  type TEENodeStatus,
  type TEENodeWarmth,
  type TEEHardwareInfo,
  type TEENode,
  type TEEDeploymentConfig,
  type TEEProvisionRequest,
  type TEEProvisionResult,
  type TEEProvider,
  type TEEGateway as ITEEGateway,
  type TEEEnclaveClient,
} from './tee-interface.js';

export { TEEGateway } from './tee-gateway.js';

export type { TEEDeploymentConfig as DeploymentConfig } from './tee-interface.js';
export type { TEEProvisionRequest as ProvisionRequest } from './tee-interface.js';

export {
  type DeploymentResult,
  decodeIPFSContenthash,
  type ENSConfig,
  ENSDeployer,
  encodeArweaveContenthash,
  encodeIPFSContenthash,
  uploadToArweave as uploadToArweaveENS,
  uploadToLocalIPFS as uploadToLocalIPFSENS,
} from './ens-deployer.js';

export {
  ENSRegistrar,
  encodeArweaveContenthash as encodeArweaveContenthashRegistrar,
  encodeIPFSContenthash as encodeENSIPFSContenthash,
  type RegistrationResult,
} from './ens-registrar.js';

export {
  AttestationABI,
  AttestationClient,
  generateSimulatedAttestation,
  OnChainAttestationClient,
  type OnChainRegistration,
  type TEEAttestation,
  verifyAttestationLocally,
} from './onchain-attestation.js';

export {
  checkGatewayHealth,
  isLocalIPFSAvailable,
  retrieveFromArweave,
  retrieveFromIPFS,
  runFullStorageTest,
  uploadToArweave,
  uploadToLocalIPFS,
} from './real-storage-test.js';
