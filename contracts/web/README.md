# Jeju Registry Viewer

Web-based viewer for the ERC-8004 Agent Registry system on Jeju Network.

## Features

- 📊 View all registered agents on the network
- 🔍 Browse agent metadata and details
- 🌐 Support for Localnet, Testnet, and Mainnet
- 💼 Connect with MetaMask or any Web3 wallet
- ⚡ Real-time updates from blockchain

## Quick Start

### Local Development

1. **Start a local server:**
   ```bash
   # Using Python
   cd contracts/web
   python3 -m http.server 3000
   
   # Or using Node.js
   npx serve -p 3000
   ```

2. **Open browser:**
   Navigate to `http://localhost:3000/registry-viewer.html`

3. **Connect wallet:**
   - Select network (Localnet/Testnet/Mainnet)
   - Click "Connect Wallet"
   - Approve MetaMask connection
   - Agents will load automatically

## Network Configuration

The viewer supports three networks:

### Localnet (Chain ID: 1337)
- L2 RPC: `http://127.0.0.1:9545` (STATIC - use for wallets)
- L1 RPC: `http://127.0.0.1:8545` (L1 only)
- For local development and testing

### Testnet (Chain ID: 16602)
- RPC: `https://rpc.testnet.jeju.network`
- For testing before mainnet deployment

### Mainnet (Chain ID: 919)
- RPC: `https://rpc.mainnet.jeju.network`
- Production network

## Contract Addresses

Addresses are automatically loaded from deployment files:
- `contracts/deployments/localnet/liquidity-system.json`
- `contracts/deployments/testnet/liquidity-system.json`
- `contracts/deployments/mainnet/liquidity-system.json`

If files don't exist, you'll be prompted to enter addresses manually.

## Agent Display

For each agent, the viewer shows:
- **Agent ID**: Unique NFT token ID
- **Owner Address**: Current owner of the agent NFT
- **Token URI**: Link to off-chain metadata
- **Metadata**: On-chain key-value data

Common metadata keys:
- `name`: Agent name
- `description`: Agent description
- `type`: Agent type (chatbot, trading, etc.)
- `version`: Agent version
- `model`: AI model used
- `capabilities`: Agent capabilities

## Development

### Adding Custom Metadata

To display custom metadata keys, edit `registry-viewer.html` and update the `commonKeys` array:

```javascript
const commonKeys = ['name', 'description', 'type', 'version', 'yourCustomKey'];
```

### Styling

The viewer uses a modern gradient design with:
- Purple gradient background
- Card-based layout
- Hover animations
- Responsive grid

Customize by editing the `<style>` section.

## Integration with Paymaster System

Registered agents can:
1. Earn fees through the paymaster system by setting their address as `revenueWallet`
2. Build reputation through the ReputationRegistry
3. Get validated through the ValidationRegistry
4. Transfer ownership as ERC-721 NFTs

## Troubleshooting

### "No agents registered yet"
- Deploy an agent using `IdentityRegistry.register()`
- Check you're connected to the correct network

### "Cannot connect wallet"
- Ensure MetaMask is installed
- Check network is added to MetaMask
- Verify RPC URL is accessible

### "Contract not found"
- Verify deployment was successful
- Check deployment JSON file exists
- Manually enter contract address if prompted

## API Reference

### IdentityRegistry Contract

```solidity
// Register agent
function register(string calldata tokenURI) external returns (uint256 agentId);

// Set metadata
function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external;

// Get metadata
function getMetadata(uint256 agentId, string calldata key) external view returns (bytes memory);

// Check existence
function agentExists(uint256 agentId) external view returns (bool);

// Get total
function totalAgents() external view returns (uint256);
```

## Support

- Documentation: https://docs.jeju.network
- Discord: https://discord.gg/jeju
- GitHub: https://github.com/jeju-network

## License

CC0-1.0 (ERC-8004 Standard)
MIT (Jeju Integration)

