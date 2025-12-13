// Type stubs for Lit Protocol - module is optional
declare module '@lit-protocol/lit-node-client' {
  export class LitNodeClient {
    ready: boolean;
    constructor(config: { litNetwork: string; debug?: boolean });
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getSessionSigs(params: Record<string, unknown>): Promise<Record<string, unknown>>;
    encrypt(params: Record<string, unknown>): Promise<{ ciphertext: string; dataToEncryptHash: string }>;
    decrypt(params: Record<string, unknown>): Promise<{ decryptedData: Uint8Array }>;
  }
}

