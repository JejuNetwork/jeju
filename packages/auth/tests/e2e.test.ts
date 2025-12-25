/**
 * OAuth3 E2E Tests
 *
 * End-to-end tests validating the full OAuth3 flow including:
 * - FROST threshold signing
 * - Verifiable credentials
 * - On-chain identity registration
 * - Cross-chain identity sync
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { FROSTCoordinator, generateKeyShares } from '@jejunetwork/kms'
import { type Address, type Hex, keccak256, toBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createMultiTenantCouncilManager } from '../src/council/multi-tenant.js'
import {
  credentialToOnChainAttestation,
  didFromAddress,
  VerifiableCredentialIssuer,
  VerifiableCredentialVerifier,
} from '../src/credentials/verifiable-credentials.js'
import {
  ChainId,
  CrossChainIdentityManager,
  computeIntentHash,
} from '../src/intents/cross-chain-identity.js'
import type {
  AuthProvider,
  OAuth3Identity,
  OAuth3Session,
} from '../src/types.js'

const TEST_CHAIN_ID = 420691

describe('FROST Threshold Signing', () => {
  test('generates valid key shares with threshold', () => {
    const threshold = 3
    const totalParties = 5

    const shares = generateKeyShares(threshold, totalParties)

    expect(shares).toHaveLength(totalParties)

    for (const share of shares) {
      expect(share.index).toBeGreaterThan(0)
      expect(share.secretShare).toBeDefined()
      expect(share.publicShare).toBeDefined()
      expect(share.groupPublicKey).toBeDefined()
    }

    for (const share of shares) {
      expect(share.groupPublicKey.equals(shares[0].groupPublicKey)).toBe(true)
    }
  })

  test('coordinator signs message with threshold parties', async () => {
    const coordinator = new FROSTCoordinator('test-cluster', 2, 3)
    await coordinator.initializeCluster()

    const cluster = coordinator.getCluster()
    expect(cluster.parties).toHaveLength(3)
    expect(cluster.threshold).toBe(2)
    expect(cluster.groupAddress).toBeDefined()

    const message = keccak256(toBytes('Hello, FROST!'))
    const signature = await coordinator.sign(message, [1, 2])

    expect(signature.r).toBeDefined()
    expect(signature.s).toBeDefined()
    expect(signature.v).toBeGreaterThanOrEqual(27)
  })

  test('derives correct address from group public key', async () => {
    const coordinator = new FROSTCoordinator('address-test', 2, 3)
    await coordinator.initializeCluster()

    const address = coordinator.getAddress()
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  test('fails with insufficient parties', async () => {
    const coordinator = new FROSTCoordinator('fail-test', 3, 5)
    await coordinator.initializeCluster()

    const message = keccak256(toBytes('Test'))

    expect(() => coordinator.sign(message, [1, 2])).toThrow()
  })
})

describe('Verifiable Credentials', () => {
  let issuer: VerifiableCredentialIssuer
  let verifier: VerifiableCredentialVerifier
  let testWalletAddress: Address

  beforeAll(() => {
    const issuerPrivateKey = generatePrivateKey()
    issuer = new VerifiableCredentialIssuer(
      issuerPrivateKey,
      'Jeju OAuth3 Test Issuer',
      TEST_CHAIN_ID,
    )
    verifier = new VerifiableCredentialVerifier(TEST_CHAIN_ID)
    verifier.addTrustedIssuer(issuer.getIssuerDid())

    testWalletAddress = privateKeyToAccount(generatePrivateKey()).address
  })

  test('issues valid credential', async () => {
    const credential = await issuer.issueCredential({
      issuerDid: issuer.getIssuerDid(),
      issuerName: 'Jeju OAuth3 Test Issuer',
      subjectDid: didFromAddress(testWalletAddress, TEST_CHAIN_ID),
      provider: 'google' as AuthProvider,
      providerId: 'google-12345',
      providerHandle: 'test@example.com',
      walletAddress: testWalletAddress,
    })

    expect(credential['@context']).toContain(
      'https://www.w3.org/2018/credentials/v1',
    )
    expect(credential.type).toContain('VerifiableCredential')
    expect(credential.type).toContain('OAuth3IdentityCredential')
    expect(credential.proof.proofValue).not.toBe('0x')
    expect(credential.credentialSubject.provider).toBe('google')
    expect(credential.credentialSubject.walletAddress).toBe(testWalletAddress)
  })

  test('verifies valid credential', async () => {
    const credential = await issuer.issueCredential({
      issuerDid: issuer.getIssuerDid(),
      issuerName: 'Jeju OAuth3 Test Issuer',
      subjectDid: didFromAddress(testWalletAddress, TEST_CHAIN_ID),
      provider: 'farcaster' as AuthProvider,
      providerId: '12345',
      providerHandle: '@testuser',
      walletAddress: testWalletAddress,
    })

    const result = await verifier.verify(credential)

    expect(result.valid).toBe(true)
    expect(result.checks.expiration).toBe(true)
    expect(result.checks.issuer).toBe(true)
    expect(result.checks.schema).toBe(true)
  })

  test('rejects expired credential', async () => {
    const credential = await issuer.issueCredential({
      issuerDid: issuer.getIssuerDid(),
      issuerName: 'Jeju OAuth3 Test Issuer',
      subjectDid: didFromAddress(testWalletAddress, TEST_CHAIN_ID),
      provider: 'twitter' as AuthProvider,
      providerId: 'twitter-123',
      providerHandle: '@test',
      walletAddress: testWalletAddress,
      expirationDays: -1,
    })

    const result = await verifier.verify(credential)

    expect(result.valid).toBe(false)
    expect(result.checks.expiration).toBe(false)
    expect(result.errors).toContain('Credential has expired')
  })

  test('rejects untrusted issuer', async () => {
    const untrustedIssuerPrivateKey = generatePrivateKey()
    const untrustedIssuer = new VerifiableCredentialIssuer(
      untrustedIssuerPrivateKey,
      'Untrusted Issuer',
      TEST_CHAIN_ID,
    )

    const credential = await untrustedIssuer.issueCredential({
      issuerDid: untrustedIssuer.getIssuerDid(),
      issuerName: 'Untrusted Issuer',
      subjectDid: didFromAddress(testWalletAddress, TEST_CHAIN_ID),
      provider: 'github' as AuthProvider,
      providerId: 'github-123',
      providerHandle: 'testuser',
      walletAddress: testWalletAddress,
    })

    const result = await verifier.verify(credential)

    expect(result.valid).toBe(false)
    expect(result.checks.issuer).toBe(false)
  })

  test('converts credential to on-chain attestation', async () => {
    const credential = await issuer.issueCredential({
      issuerDid: issuer.getIssuerDid(),
      issuerName: 'Jeju OAuth3 Test Issuer',
      subjectDid: didFromAddress(testWalletAddress, TEST_CHAIN_ID),
      provider: 'discord' as AuthProvider,
      providerId: 'discord-12345',
      providerHandle: 'testuser#1234',
      walletAddress: testWalletAddress,
    })

    const attestation = credentialToOnChainAttestation(credential)

    expect(attestation.provider).toBe(6)
    expect(attestation.providerId).toMatch(/^0x[a-fA-F0-9]{64}$/)
    expect(attestation.credentialHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    expect(attestation.issuedAt).toBeLessThan(attestation.expiresAt)
  })

  test('creates verifiable presentation', async () => {
    const credential1 = await issuer.issueCredential({
      issuerDid: issuer.getIssuerDid(),
      issuerName: 'Jeju OAuth3 Test Issuer',
      subjectDid: didFromAddress(testWalletAddress, TEST_CHAIN_ID),
      provider: 'google' as AuthProvider,
      providerId: 'google-1',
      providerHandle: 'user1@example.com',
      walletAddress: testWalletAddress,
    })

    const credential2 = await issuer.issueCredential({
      issuerDid: issuer.getIssuerDid(),
      issuerName: 'Jeju OAuth3 Test Issuer',
      subjectDid: didFromAddress(testWalletAddress, TEST_CHAIN_ID),
      provider: 'farcaster' as AuthProvider,
      providerId: '54321',
      providerHandle: '@testuser',
      walletAddress: testWalletAddress,
    })

    const presentation = await issuer.createPresentation(
      [credential1, credential2],
      didFromAddress(testWalletAddress, TEST_CHAIN_ID),
      'test-challenge-123',
    )

    expect(presentation.type).toContain('VerifiablePresentation')
    expect(presentation.verifiableCredential).toHaveLength(2)
    expect(presentation.holder).toBe(
      didFromAddress(testWalletAddress, TEST_CHAIN_ID),
    )
    expect(presentation.proof.proofValue).not.toBe('0x')
  })
})

describe('Multi-tenant Council', () => {
  let manager: MultiTenantCouncilManager

  beforeAll(async () => {
    manager = await createMultiTenantCouncilManager(
      '0x0000000000000000000000000000000000000001' as Address,
      '0x0000000000000000000000000000000000000002' as Address,
      TEST_CHAIN_ID,
    )
  })

  test('initializes default councils', () => {
    const councils = manager.getAllCouncils()
    expect(councils).toHaveLength(2)

    const councilTypes = councils.map((c) => c.councilType)
    expect(councilTypes).toContain('jeju')
    expect(councilTypes).toContain('eliza')
  })

  test('each council has unique config', () => {
    const jeju = manager.getCouncil('jeju' as const)
    const eliza = manager.getCouncil('eliza' as const)

    expect(jeju?.config.name).toBe('Jeju Network Council')
    expect(eliza?.config.name).toBe('ElizaOS Council')

    expect(jeju?.config.councilId).not.toBe(eliza?.config.councilId)
  })

  test('each council has OAuth3 app', () => {
    const councils = manager.getAllCouncils()

    for (const council of councils) {
      expect(council.oauth3App).toBeDefined()
      expect(council.oauth3App.appId).toMatch(/^0x[a-fA-F0-9]{64}$/)
      expect(council.oauth3App.allowedProviders.length).toBeGreaterThan(0)
    }
  })

  test('each council has CEO and agents', () => {
    const councils = manager.getAllCouncils()

    for (const council of councils) {
      expect(council.ceo).toBeDefined()
      expect(council.ceo.name).toBeDefined()
      expect(council.ceo.modelProvider).toBe('anthropic')

      expect(council.agents.length).toBeGreaterThan(0)

      const totalWeight = council.agents.reduce(
        (sum, a) => sum + a.votingWeight,
        0,
      )
      expect(totalWeight).toBe(100)
    }
  })

  test('validates council access', async () => {
    const jeju = manager.getCouncil('jeju' as const)
    if (!jeju) throw new Error('Jeju council not found')

    const ceoAccess = await manager.validateCouncilAccess(
      'jeju' as const,
      jeju.ceo.address,
    )

    expect(ceoAccess.hasAccess).toBe(true)
    expect(ceoAccess.roles).toContain('ceo')

    const randomAccess = await manager.validateCouncilAccess(
      'jeju' as const,
      '0x1234567890123456789012345678901234567890' as Address,
    )

    expect(randomAccess.hasAccess).toBe(false)
    expect(randomAccess.roles).toHaveLength(0)
  })

  test('updates council CEO', async () => {
    await manager.updateCouncilCEO('jeju' as const, {
      modelId: 'claude-sonnet-4-20250514',
    })

    const jeju = manager.getCouncil('jeju' as const)
    if (!jeju) throw new Error('Jeju council not found')
    expect(jeju.ceo.modelId).toBe('claude-sonnet-4-20250514')
  })

  test('gets council stats', () => {
    const stats = manager.getCouncilStats()

    expect(stats.totalCouncils).toBe(3)
    expect(stats.totalAgents).toBeGreaterThan(0)
    expect(Object.keys(stats.councilBreakdown)).toHaveLength(3)
  })
})

describe('Cross-chain Identity', () => {
  let identityManager: CrossChainIdentityManager
  let testIdentity: OAuth3Identity
  let testSession: OAuth3Session

  beforeAll(() => {
    identityManager = new CrossChainIdentityManager(ChainId.JEJU_LOCALNET)

    const ownerAddress = privateKeyToAccount(generatePrivateKey()).address
    const identityId = keccak256(
      toBytes(`identity:${ownerAddress}:${Date.now()}`),
    )

    testIdentity = {
      identityId,
      owner: ownerAddress,
      smartAccount: '0x1234567890123456789012345678901234567890' as Address,
      linkedProviders: [],
      credentials: [],
      createdAt: Date.now(),
      metadata: {},
    }

    testSession = {
      sessionId: keccak256(toBytes(`session:${Date.now()}`)),
      identityId,
      smartAccount: testIdentity.smartAccount,
      expiresAt: Date.now() + 86400000,
      capabilities: ['sign_message'],
      signingKey: generatePrivateKey(),
      attestation: {
        quote: '0x' as Hex,
        measurement: '0x' as Hex,
        reportData: '0x' as Hex,
        timestamp: Date.now(),
        provider: 'simulated',
        verified: false,
      },
    }
  })

  test('gets supported chains', () => {
    const chains = identityManager.getSupportedChains()

    expect(chains.length).toBeGreaterThan(0)
    expect(chains.map((c) => c.chainId)).toContain(ChainId.JEJU_LOCALNET)
    expect(chains.map((c) => c.chainId)).toContain(ChainId.BASE)
    expect(chains.map((c) => c.chainId)).toContain(ChainId.ETHEREUM)
  })

  test('creates cross-chain identity', async () => {
    const state = await identityManager.createCrossChainIdentity(testIdentity, [
      ChainId.BASE,
      ChainId.ETHEREUM,
      ChainId.ARBITRUM,
    ])

    expect(state.identityId).toBe(testIdentity.identityId)
    expect(state.owner).toBe(testIdentity.owner)
    expect(state.chainStates.size).toBe(4)

    const jejuState = state.chainStates.get(ChainId.JEJU_LOCALNET)
    expect(jejuState?.deployed).toBe(true)
    expect(jejuState?.smartAccount).toBe(testIdentity.smartAccount)

    const baseState = state.chainStates.get(ChainId.BASE)
    expect(baseState?.deployed).toBe(false)
    expect(baseState?.smartAccount).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  test('computes deterministic smart account addresses', () => {
    const address1 = identityManager.computeSmartAccountAddress(
      testIdentity.identityId,
      testIdentity.owner,
      ChainId.BASE,
    )

    const address2 = identityManager.computeSmartAccountAddress(
      testIdentity.identityId,
      testIdentity.owner,
      ChainId.BASE,
    )

    expect(address1).toBe(address2)

    const address3 = identityManager.computeSmartAccountAddress(
      testIdentity.identityId,
      testIdentity.owner,
      ChainId.ETHEREUM,
    )

    expect(address3).not.toBe(address1)
  })

  test('creates identity sync intent', async () => {
    await identityManager.createCrossChainIdentity(testIdentity, [ChainId.BASE])

    const syncIntent = await identityManager.createIdentitySyncIntent(
      testIdentity.identityId,
      ChainId.JEJU_LOCALNET,
      ChainId.BASE,
      testSession,
    )

    expect(syncIntent.sourceChain).toBe(ChainId.JEJU_LOCALNET)
    expect(syncIntent.targetChain).toBe(ChainId.BASE)
    expect(syncIntent.identityId).toBe(testIdentity.identityId)
    expect(syncIntent.proof).toMatch(/^0x[a-fA-F0-9]{64}$/)
    expect(syncIntent.deadline).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  test('creates cross-chain auth intent', async () => {
    await identityManager.createCrossChainIdentity(testIdentity, [ChainId.BASE])

    const authIntent = await identityManager.createCrossChainAuthIntent(
      testSession,
      ChainId.BASE,
      '0x1234567890123456789012345678901234567890' as Address,
      '0xa9059cbb' as Hex,
      '0x' as Hex,
      0n,
    )

    expect(authIntent.sourceChain).toBe(ChainId.JEJU_LOCALNET)
    expect(authIntent.targetChain).toBe(ChainId.BASE)
    expect(authIntent.identityId).toBe(testSession.identityId)

    const intentHash = computeIntentHash(authIntent)
    expect(intentHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
  })

  test('submits and tracks intent', async () => {
    await identityManager.createCrossChainIdentity(testIdentity, [ChainId.BASE])

    const authIntent = await identityManager.createCrossChainAuthIntent(
      testSession,
      ChainId.BASE,
      '0x1234567890123456789012345678901234567890' as Address,
      '0xa9059cbb' as Hex,
      '0x' as Hex,
      0n,
    )

    const { intentId, status } = await identityManager.submitIntent(authIntent)

    expect(intentId).toMatch(/^0x[a-fA-F0-9]{64}$/)
    expect(status).toBe('pending')

    const intentStatus = await identityManager.getIntentStatus(intentId)
    expect(['pending', 'solving', 'executed', 'failed']).toContain(
      intentStatus.status,
    )
  })
})

describe('Integration: Full OAuth3 Flow', () => {
  test('end-to-end: identity creation, credential, cross-chain', async () => {
    const ownerPrivateKey = generatePrivateKey()
    const ownerAddress = privateKeyToAccount(ownerPrivateKey).address

    const frostCoordinator = new FROSTCoordinator('oauth3-mpc', 2, 3)
    await frostCoordinator.initializeCluster()
    const mpcAddress = frostCoordinator.getAddress()

    const issuerPrivateKey = generatePrivateKey()
    const issuer = new VerifiableCredentialIssuer(
      issuerPrivateKey,
      'OAuth3 TEE Network',
      TEST_CHAIN_ID,
    )

    const identityId = keccak256(
      toBytes(`identity:${ownerAddress}:${Date.now()}`),
    )

    const identity: OAuth3Identity = {
      identityId,
      owner: ownerAddress,
      smartAccount: mpcAddress,
      linkedProviders: [],
      credentials: [],
      createdAt: Date.now(),
      metadata: {},
    }

    const credential = await issuer.issueCredential({
      issuerDid: issuer.getIssuerDid(),
      issuerName: 'OAuth3 TEE Network',
      subjectDid: didFromAddress(ownerAddress, TEST_CHAIN_ID),
      provider: 'google' as AuthProvider,
      providerId: 'google-test-user-123',
      providerHandle: 'testuser@gmail.com',
      walletAddress: ownerAddress,
    })

    identity.credentials.push(credential)
    identity.linkedProviders.push({
      provider: 'google' as AuthProvider,
      providerId: 'google-test-user-123',
      providerHandle: 'testuser@gmail.com',
      linkedAt: Date.now(),
      verified: true,
      credential,
    })

    const crossChainManager = new CrossChainIdentityManager(
      ChainId.JEJU_LOCALNET,
    )
    const crossChainState = await crossChainManager.createCrossChainIdentity(
      identity,
      [ChainId.BASE, ChainId.ETHEREUM],
    )

    expect(crossChainState.chainStates.size).toBe(3)

    const message = keccak256(toBytes('Test transaction for OAuth3'))
    const signature = await frostCoordinator.sign(message, [1, 2])

    expect(signature.r).toBeDefined()
    expect(signature.s).toBeDefined()

    console.log('\n✅ Full OAuth3 E2E Flow Completed:')
    console.log(`   - Identity ID: ${identity.identityId.slice(0, 18)}...`)
    console.log(`   - Smart Account (MPC): ${identity.smartAccount}`)
    console.log(`   - Credential Issued: ${credential.type.join(', ')}`)
    console.log(
      `   - Cross-chain Deployments: ${crossChainState.chainStates.size} chains`,
    )
    console.log(
      `   - MPC Signature Generated: r=${signature.r.slice(0, 18)}...`,
    )
  })
})
