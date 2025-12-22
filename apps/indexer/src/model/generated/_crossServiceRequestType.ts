export const CrossServiceRequestType = {
  CONTAINER_PULL: 'CONTAINER_PULL',
  DATA_LOAD: 'DATA_LOAD',
  MODEL_FETCH: 'MODEL_FETCH',
  OUTPUT_STORE: 'OUTPUT_STORE',
} as const
export type CrossServiceRequestType =
  (typeof CrossServiceRequestType)[keyof typeof CrossServiceRequestType]
