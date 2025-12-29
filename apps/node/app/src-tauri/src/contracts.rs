//! Contract bindings and provider for interacting with Jeju Network contracts
//!
//! Uses alloy for type-safe contract interactions.

use alloy::primitives::{Address, U256};
use alloy::providers::{Provider, ProviderBuilder, RootProvider};
use alloy::sol;
use alloy::transports::http::{Client, Http};
use std::str::FromStr;
use std::sync::Arc;

// Generate type-safe bindings for NodeStakingManager
sol! {
    #[sol(rpc)]
    interface INodeStakingManager {
        struct NodeStake {
            address operator;
            bytes32 nodeId;
            address stakingToken;
            uint256 stakedAmount;
            uint256 stakedValueUSD;
            address rewardToken;
            uint256 pendingRewards;
            uint256 claimedRewards;
            uint256 lastClaimTime;
            uint256 registeredAt;
            string rpcUrl;
            uint8 region;
            bool isActive;
        }

        function getNodeStake(bytes32 nodeId) external view returns (NodeStake memory);
        function getOperatorNodes(address operator) external view returns (bytes32[] memory);
        function registerNode(
            address stakingToken,
            uint256 stakeAmount,
            address rewardToken,
            string calldata rpcUrl,
            uint8 region
        ) external returns (bytes32 nodeId);
        function addStake(bytes32 nodeId, uint256 amount) external;
        function initiateUnstake(bytes32 nodeId, uint256 amount) external;
        function completeUnstake(bytes32 nodeId) external;
        function claimRewards(bytes32 nodeId) external returns (uint256 amount);
        function getPendingRewards(bytes32 nodeId) external view returns (uint256);
        function getTotalStakedUSD() external view returns (uint256);
    }

    #[sol(rpc)]
    interface IERC20 {
        function balanceOf(address account) external view returns (uint256);
        function allowance(address owner, address spender) external view returns (uint256);
        function approve(address spender, uint256 amount) external returns (bool);
        function transfer(address to, uint256 amount) external returns (bool);
    }

    #[sol(rpc)]
    interface IIdentityRegistry {
        struct AgentInfo {
            address owner;
            uint256 agentId;
            string tokenURI;
            uint256 reputation;
            bool isBanned;
            uint256 banExpiry;
            string banReason;
        }

        function register(string calldata tokenURI, uint256 stakeAmount) external returns (uint256 agentId);
        function getAgentInfo(uint256 agentId) external view returns (AgentInfo memory);
        function getAgentByOwner(address owner) external view returns (uint256 agentId);
        function getBanStatus(uint256 agentId) external view returns (bool banned, uint256 expiry, string memory reason);
    }

    #[sol(rpc)]
    interface IBanManager {
        function isBanned(uint256 agentId) external view returns (bool);
        function isOnNotice(uint256 agentId) external view returns (bool);
        function isPermanentlyBanned(uint256 agentId) external view returns (bool);
        function getBanInfo(uint256 agentId) external view returns (
            bool banned,
            uint256 expiry,
            string memory reason,
            bool canAppeal
        );
    }
}

/// Client for interacting with Jeju Network contracts
pub struct ContractClient {
    provider: Arc<RootProvider<Http<Client>>>,
    addresses: ContractAddresses,
}

/// Contract addresses for a specific network
#[derive(Clone)]
pub struct ContractAddresses {
    pub node_staking_manager: Address,
    pub identity_registry: Address,
    pub ban_manager: Address,
    pub jeju_token: Address,
}

impl ContractAddresses {
    /// Get contract addresses for localnet (chainId 31337)
    pub fn localnet() -> Self {
        Self {
            // These addresses are set during local deployment
            // They should be loaded from environment or config in production
            node_staking_manager: Address::from_str("0x5FbDB2315678afecb367f032d93F642f64180aa3")
                .expect("valid address"),
            identity_registry: Address::from_str("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512")
                .expect("valid address"),
            ban_manager: Address::from_str("0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0")
                .expect("valid address"),
            jeju_token: Address::from_str("0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9")
                .expect("valid address"),
        }
    }

    /// Get contract addresses for Base Sepolia testnet (chainId 84532)
    pub fn base_sepolia() -> Self {
        Self {
            node_staking_manager: Address::from_str("0x0000000000000000000000000000000000000000")
                .expect("valid address"),
            identity_registry: Address::from_str("0x0000000000000000000000000000000000000000")
                .expect("valid address"),
            ban_manager: Address::from_str("0x0000000000000000000000000000000000000000")
                .expect("valid address"),
            jeju_token: Address::from_str("0x0000000000000000000000000000000000000000")
                .expect("valid address"),
        }
    }

    /// Get contract addresses based on chain ID
    pub fn for_chain(chain_id: u64) -> Self {
        match chain_id {
            31337 => Self::localnet(),
            84532 => Self::base_sepolia(),
            _ => Self::localnet(), // Default to localnet
        }
    }
}

impl ContractClient {
    /// Create a new contract client
    pub async fn new(rpc_url: &str, chain_id: u64) -> Result<Self, String> {
        let provider = ProviderBuilder::new().on_http(
            rpc_url
                .parse()
                .map_err(|e| format!("Invalid RPC URL: {}", e))?,
        );

        Ok(Self {
            provider: Arc::new(provider),
            addresses: ContractAddresses::for_chain(chain_id),
        })
    }

    /// Get ETH balance for an address
    pub async fn get_eth_balance(&self, address: Address) -> Result<U256, String> {
        self.provider
            .get_balance(address)
            .await
            .map_err(|e| format!("Failed to get balance: {}", e))
    }

    /// Get JEJU token balance for an address
    pub async fn get_jeju_balance(&self, address: Address) -> Result<U256, String> {
        let token = IERC20::new(self.addresses.jeju_token, &*self.provider);
        token
            .balanceOf(address)
            .call()
            .await
            .map(|r| r._0)
            .map_err(|e| format!("Failed to get JEJU balance: {}", e))
    }

    /// Get staking info for an operator
    pub async fn get_staking_info(&self, operator: Address) -> Result<Vec<NodeStakeInfo>, String> {
        let staking =
            INodeStakingManager::new(self.addresses.node_staking_manager, &*self.provider);

        // Get all node IDs for the operator
        let node_ids = staking
            .getOperatorNodes(operator)
            .call()
            .await
            .map(|r| r._0)
            .map_err(|e| format!("Failed to get operator nodes: {}", e))?;

        let mut stakes = Vec::new();
        for node_id in node_ids {
            let stake = staking
                .getNodeStake(node_id)
                .call()
                .await
                .map(|r| r._0)
                .map_err(|e| format!("Failed to get node stake: {}", e))?;

            stakes.push(NodeStakeInfo {
                node_id: format!("0x{}", hex::encode(node_id)),
                staked_amount: stake.stakedAmount.to_string(),
                staked_value_usd: stake.stakedValueUSD.to_string(),
                pending_rewards: stake.pendingRewards.to_string(),
                staking_token: format!("{:?}", stake.stakingToken),
            });
        }

        Ok(stakes)
    }

    /// Get agent info by ID
    pub async fn get_agent_info(&self, agent_id: u64) -> Result<AgentInfoResult, String> {
        let registry = IIdentityRegistry::new(self.addresses.identity_registry, &*self.provider);
        let info = registry
            .getAgentInfo(U256::from(agent_id))
            .call()
            .await
            .map(|r| r._0)
            .map_err(|e| format!("Failed to get agent info: {}", e))?;

        Ok(AgentInfoResult {
            owner: format!("{:?}", info.owner),
            token_uri: info.tokenURI,
            reputation: info.reputation.to_string(),
            is_banned: info.isBanned,
            ban_reason: info.banReason,
        })
    }

    /// Get agent ID for an owner address
    pub async fn get_agent_by_owner(&self, owner: Address) -> Result<Option<u64>, String> {
        let registry = IIdentityRegistry::new(self.addresses.identity_registry, &*self.provider);
        let agent_id = registry
            .getAgentByOwner(owner)
            .call()
            .await
            .map(|r| r.agentId)
            .map_err(|e| format!("Failed to get agent by owner: {}", e))?;

        if agent_id == U256::ZERO {
            Ok(None)
        } else {
            Ok(Some(agent_id.to::<u64>()))
        }
    }

    /// Check ban status for an agent
    pub async fn get_ban_status(&self, agent_id: u64) -> Result<BanStatusResult, String> {
        let ban_manager = IBanManager::new(self.addresses.ban_manager, &*self.provider);
        let (banned, expiry, reason, can_appeal) = ban_manager
            .getBanInfo(U256::from(agent_id))
            .call()
            .await
            .map(|r| (r.banned, r.expiry, r.reason, r.canAppeal))
            .map_err(|e| format!("Failed to get ban info: {}", e))?;

        let is_permanent = ban_manager
            .isPermanentlyBanned(U256::from(agent_id))
            .call()
            .await
            .map(|r| r._0)
            .unwrap_or(false);

        let on_notice = ban_manager
            .isOnNotice(U256::from(agent_id))
            .call()
            .await
            .map(|r| r._0)
            .unwrap_or(false);

        Ok(BanStatusResult {
            is_banned: banned,
            is_permanent,
            is_on_notice: on_notice,
            expiry: expiry.to::<u64>(),
            reason,
            can_appeal,
        })
    }
}

/// Result structure for node stake info
#[derive(Debug, Clone)]
pub struct NodeStakeInfo {
    pub node_id: String,
    pub staked_amount: String,
    pub staked_value_usd: String,
    pub pending_rewards: String,
    pub staking_token: String,
}

/// Result structure for agent info
#[derive(Debug, Clone)]
pub struct AgentInfoResult {
    pub owner: String,
    pub token_uri: String,
    pub reputation: String,
    pub is_banned: bool,
    pub ban_reason: String,
}

/// Result structure for ban status
#[derive(Debug, Clone)]
pub struct BanStatusResult {
    pub is_banned: bool,
    pub is_permanent: bool,
    pub is_on_notice: bool,
    pub expiry: u64,
    pub reason: String,
    pub can_appeal: bool,
}
