/**
 * DWS Integration Module
 *
 * Provides decentralized API aggregation for the bots package
 * through DWS (Decentralized Web Services).
 */

export {
  DWSClient,
  type DWSClientConfig,
  type DWSRequestOptions,
  type DWSResponse,
  getDWSClient,
  resetDWSClient,
} from './client'
