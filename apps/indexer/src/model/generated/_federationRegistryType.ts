export const FederationRegistryType = {
  IDENTITY: 'IDENTITY',
  COMPUTE: 'COMPUTE',
  STORAGE: 'STORAGE',
  SOLVER: 'SOLVER',
  PACKAGE: 'PACKAGE',
  CONTAINER: 'CONTAINER',
  MODEL: 'MODEL',
  NAME_SERVICE: 'NAME_SERVICE',
  REPUTATION: 'REPUTATION',
  OTHER: 'OTHER',
} as const
export type FederationRegistryType =
  (typeof FederationRegistryType)[keyof typeof FederationRegistryType]
