// Export service type constant for shell service
export const ShellServiceType = {
  SHELL: 'SHELL' as const,
};

// Extend the core service types with shell service
declare module '@elizaos/core' {
  interface ServiceTypeRegistry {
    SHELL: 'SHELL';
  }
}
