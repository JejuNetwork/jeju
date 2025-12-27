/**
 * ML/AI Model Storage Module
 *
 * Provides decentralized model storage with compatibility for:
 * - HuggingFace Hub API
 * - Git LFS for large files
 * - IPFS-backed storage
 */

export {
  createHuggingFaceRouter,
  fileRegistry,
  type HFModelConfig,
  type HFModelFile,
  type HFRepoInfo,
  modelRegistry,
} from './huggingface-compat'
