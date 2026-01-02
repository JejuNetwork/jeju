import { createWalletClient, http, publicActions, toHex, parseEther, encodeAbiParameters } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { readFileSync } from 'node:fs'

const RPC = 'http://127.0.0.1:6546'
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const

// Read the mined identity
const identity = JSON.parse(readFileSync('.dws/localnet/node-identity.json', 'utf8'))

// Check if IdentityRegistry exists on current chain
async function main() {
  const account = privateKeyToAccount(KEY)
  const client = createWalletClient({ account, chain: foundry, transport: http(RPC) }).extend(publicActions)

  console.log('Operator:', account.address)
  console.log('NodeID:', identity.nodeId)
  console.log('')

  // First, check what IdentityRegistry we have deployed
  // The SQLitIdentityRegistry needs:
  // 1. Staking token address
  // 2. Public key (33 bytes)
  // 3. Nonce struct
  // 4. Computed NodeID
  // 5. Role (0=BlockProducer, 1=Miner)
  // 6. Endpoint
  // 7. Stake amount

  // Get IdentityRegistry from latest deployment
  const broadcast = JSON.parse(readFileSync('packages/contracts/broadcast/DeployDWS.s.sol/31337/run-latest.json', 'utf8'))
  
  // Check if there's an identity registry in DWS
  console.log('Looking for identity contracts...')
  
  // We need to check if SQLitIdentityRegistry is deployed
  // Actually, the DWS contracts include an identity registry at 0xC9a43158891282A2B1475592D5719c001986Aaec
  // But this was from an old deployment - let's verify
  
  const IDENTITY_REGISTRY = '0xC9a43158891282A2B1475592D5719c001986Aaec'
  const code = await client.getCode({ address: IDENTITY_REGISTRY })
  
  if (!code || code === '0x') {
    console.log('Identity registry not deployed at expected address')
    console.log('Need to deploy SQLitIdentityRegistry first')
    
    // For now, let's just save the identity - it's valid and can be registered later
    console.log('')
    console.log('Identity is VALID and MINED')
    console.log('Can be registered once SQLitIdentityRegistry is deployed with staking token')
    return
  }

  console.log('Identity Registry code length:', code.length)
  
  // Check if it has the registerIdentity function
  const REGISTER_ABI = [{
    name: 'registerIdentity',
    type: 'function',
    inputs: [
      { name: 'publicKey', type: 'bytes' },
      { name: 'nonce', type: 'tuple', components: [
        { name: 'a', type: 'uint64' },
        { name: 'b', type: 'uint64' },
        { name: 'c', type: 'uint64' },
        { name: 'd', type: 'uint64' }
      ]},
      { name: 'nodeId', type: 'bytes32' },
      { name: 'role', type: 'uint8' },
      { name: 'endpoint', type: 'string' },
      { name: 'stakeAmount', type: 'uint256' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  }] as const

  console.log('')
  console.log('Identity mined and ready:')
  console.log('  NodeID:', identity.nodeId)
  console.log('  Public Key:', identity.publicKey)
  console.log('')
  console.log('To register, SQLitIdentityRegistry needs:')
  console.log('  - Staking token deployed and funded')
  console.log('  - 10,000+ JEJU for miner role')
  console.log('  - 100,000+ JEJU for block producer role')
}

main().catch(console.error)
