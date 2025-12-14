#!/usr/bin/env bun
/**
 * Integration test for P2P threshold signing
 * 
 * This test:
 * 1. Starts 3 signer services locally
 * 2. Deploys ThresholdBatchSubmitter contract
 * 3. Collects signatures from signers
 * 4. Submits a batch with threshold signatures
 * 5. Verifies the batch was accepted
 */

import { spawn, type Subprocess } from 'bun';
import { 
  Wallet, 
  JsonRpcProvider, 
  Contract, 
  ContractFactory,
  TypedDataEncoder,
  NonceManager
} from 'ethers';

const ACCOUNTS = [
  { 
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
  },
  { 
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  },
  { 
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
  },
];

const RPC_URL = process.env.L1_RPC_URL || 'http://localhost:8545';
const THRESHOLD = 2;
const SIGNER_BASE_PORT = 4200;

interface SignerProcess {
  process: Subprocess;
  port: number;
  address: string;
  url: string;
}

interface SignResponse {
  signature: string;
  signer: string;
  error?: string;
}

class P2PSigningTest {
  private provider: JsonRpcProvider;
  private deployer: NonceManager;
  private signers: SignerProcess[] = [];
  private submitterContract?: Contract;

  constructor() {
    this.provider = new JsonRpcProvider(RPC_URL);
    const wallet = new Wallet(ACCOUNTS[0].privateKey, this.provider);
    this.deployer = new NonceManager(wallet);
  }

  async startSigners(): Promise<void> {
    console.log('\n Starting signer services...');

    for (let i = 0; i < 3; i++) {
      const port = SIGNER_BASE_PORT + i;
      const account = ACCOUNTS[i];

      const proc = spawn({
        cmd: ['bun', 'run', 'signer-service.ts'],
        cwd: import.meta.dir,
        env: {
          ...process.env,
          SIGNER_PRIVATE_KEY: account.privateKey,
          SIGNER_PORT: port.toString(),
        },
        stdout: 'ignore',
        stderr: 'ignore',
      });

      this.signers.push({
        process: proc,
        port,
        address: account.address,
        url: `http://localhost:${port}`,
      });

      console.log(`  Signer ${i + 1}: ${account.address} on port ${port}`);
    }

    await this.waitForSigners();
    console.log('  All signers ready\n');
  }

  private async waitForSigners(): Promise<void> {
    const maxAttempts = 30;
    
    for (const signer of this.signers) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const response = await fetch(`${signer.url}/health`);
          if (response.ok) break;
        } catch {
          // Signer not ready
        }
        await Bun.sleep(100);
      }
    }
  }

  async deployContract(): Promise<void> {
    console.log('Deploying ThresholdBatchSubmitter...');

    const artifactPath = `${import.meta.dir}/../../packages/contracts/out/ThresholdBatchSubmitter.sol/ThresholdBatchSubmitter.json`;
    const artifact = await Bun.file(artifactPath).json();

    const batchInbox = '0x0000000000000000000000000000000000004200';
    const owner = ACCOUNTS[0].address;
    
    // Use ContractFactory for deployment
    const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, this.deployer);
    
    // Constructor: (address _batchInbox, address _owner, uint256 _threshold)
    const contract = await factory.deploy(batchInbox, owner, THRESHOLD);
    await contract.waitForDeployment();

    const contractAddress = await contract.getAddress();
    this.submitterContract = new Contract(contractAddress, artifact.abi, this.deployer);
    console.log(`  Contract deployed at: ${contractAddress}`);

    // Register all sequencers
    console.log('  Registering sequencers...');
    for (const account of ACCOUNTS) {
      const tx = await this.submitterContract.addSequencer(account.address);
      await tx.wait();
      console.log(`    Added sequencer: ${account.address}`);
    }
    console.log('');
  }

  async testSignatureCollection(): Promise<void> {
    console.log('Testing signature collection...');

    const batchData = '0xdeadbeefcafebabe';
    const requestId = `test-${Date.now()}`;
    const chainId = Number((await this.provider.getNetwork()).chainId);

    // Get the digest from the contract (matches the contract's _hashTypedData)
    const nonce = await this.submitterContract!.getCurrentNonce();
    const digest = await this.submitterContract!.getBatchDigest(batchData);
    console.log(`  Batch digest from contract: ${digest}`);

    const signatures: string[] = [];
    const signerAddresses: string[] = [];

    // Use simple signing endpoint that signs a raw hash
    for (let i = 0; i < THRESHOLD; i++) {
      const signer = this.signers[i];
      
      const response = await fetch(`${signer.url}/sign-digest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          digest,
          timestamp: Date.now(),
        }),
      });

      const result = await response.json() as SignResponse;
      
      if (result.error) {
        throw new Error(result.error);
      }

      signatures.push(result.signature);
      signerAddresses.push(result.signer);
      console.log(`  Got signature from ${result.signer}`);
    }

    console.log(`  Collected ${signatures.length} signatures\n`);

    console.log('Submitting batch...');
    const tx = await this.submitterContract!.submitBatch(
      batchData,
      signatures,
      signerAddresses
    );
    const receipt = await tx.wait();
    console.log(`  Batch submitted in tx: ${receipt.hash}`);
    console.log(`  Gas used: ${receipt.gasUsed.toString()}\n`);

    const newNonce = await this.submitterContract!.getCurrentNonce();
    if (newNonce !== nonce + 1n) {
      throw new Error(`Nonce did not increment`);
    }
    console.log(`  Nonce incremented to ${newNonce}\n`);
  }

  async cleanup(): Promise<void> {
    console.log('Cleaning up...');
    for (const signer of this.signers) {
      signer.process.kill();
    }
    console.log('  Signers stopped\n');
  }

  async run(): Promise<void> {
    console.log('P2P Threshold Signing Integration Test');
    console.log('='.repeat(50));

    try {
      try {
        await this.provider.getBlockNumber();
      } catch {
        console.error('\nError: Anvil not running. Start it with: anvil\n');
        process.exit(1);
      }

      await this.startSigners();
      await this.deployContract();
      await this.testSignatureCollection();

      console.log('='.repeat(50));
      console.log('All P2P signing tests passed');
      console.log('='.repeat(50));
    } catch (error) {
      console.error('\nTest failed:', error);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }
}

const test = new P2PSigningTest();
test.run();


