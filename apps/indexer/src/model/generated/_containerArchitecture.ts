export const ContainerArchitecture = {
  AMD64: 'AMD64',
  ARM64: 'ARM64',
  MULTI: 'MULTI',
} as const
export type ContainerArchitecture =
  (typeof ContainerArchitecture)[keyof typeof ContainerArchitecture]
