//! Wallet management - embedded and external wallet support

use ethers::prelude::*;
use ethers::signers::{LocalWallet, Signer};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::sync::Arc;

/// Wallet information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletInfo {
    pub address: String,
    pub wallet_type: String,
    pub agent_id: Option<u64>,
    pub is_registered: bool,
}

/// Balance information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BalanceInfo {
    pub eth: String,
    pub jeju: String,
    pub staked: String,
    pub pending_rewards: String,
}

/// Transaction result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionResult {
    pub hash: String,
    pub status: String,
    pub block_number: Option<u64>,
    pub gas_used: Option<String>,
}

/// Wallet manager handles both embedded and external wallets
pub struct WalletManager {
    wallet: Option<LocalWallet>,
    provider: Option<Arc<Provider<Http>>>,
    chain_id: u64,
    rpc_url: String,
}

impl WalletManager {
    pub fn new(rpc_url: &str, chain_id: u64) -> Self {
        Self {
            wallet: None,
            provider: None,
            chain_id,
            rpc_url: rpc_url.to_string(),
        }
    }

    /// Create a new embedded wallet
    pub fn create_wallet(&mut self, password: &str) -> Result<WalletInfo, String> {
        // Generate new wallet
        let wallet = LocalWallet::new(&mut rand::thread_rng());
        let address = format!("{:?}", wallet.address());
        
        // Encrypt private key with password
        let encrypted = self.encrypt_private_key(&wallet, password)?;
        
        self.wallet = Some(wallet.with_chain_id(self.chain_id));
        
        // Initialize provider
        self.init_provider()?;
        
        Ok(WalletInfo {
            address,
            wallet_type: "embedded".to_string(),
            agent_id: None,
            is_registered: false,
        })
    }

    /// Import wallet from private key
    pub fn import_wallet(&mut self, private_key: &str, password: &str) -> Result<WalletInfo, String> {
        let wallet: LocalWallet = private_key
            .parse()
            .map_err(|e| format!("Invalid private key: {}", e))?;
        
        let address = format!("{:?}", wallet.address());
        
        // Encrypt for storage
        let _encrypted = self.encrypt_private_key(&wallet, password)?;
        
        self.wallet = Some(wallet.with_chain_id(self.chain_id));
        
        // Initialize provider
        self.init_provider()?;
        
        Ok(WalletInfo {
            address,
            wallet_type: "embedded".to_string(),
            agent_id: None,
            is_registered: false,
        })
    }

    /// Import wallet from mnemonic
    pub fn import_from_mnemonic(&mut self, mnemonic: &str, password: &str) -> Result<WalletInfo, String> {
        let wallet = MnemonicBuilder::<English>::default()
            .phrase(mnemonic)
            .build()
            .map_err(|e| format!("Invalid mnemonic: {}", e))?;
        
        let address = format!("{:?}", wallet.address());
        
        // Encrypt for storage
        let _encrypted = self.encrypt_private_key(&wallet, password)?;
        
        self.wallet = Some(wallet.with_chain_id(self.chain_id));
        
        // Initialize provider
        self.init_provider()?;
        
        Ok(WalletInfo {
            address,
            wallet_type: "embedded".to_string(),
            agent_id: None,
            is_registered: false,
        })
    }

    /// Load encrypted wallet
    pub fn load_wallet(&mut self, encrypted_key: &str, password: &str) -> Result<WalletInfo, String> {
        let private_key = self.decrypt_private_key(encrypted_key, password)?;
        self.import_wallet(&private_key, password)
    }

    /// Get wallet info
    pub fn get_info(&self) -> Option<WalletInfo> {
        self.wallet.as_ref().map(|w| WalletInfo {
            address: format!("{:?}", w.address()),
            wallet_type: "embedded".to_string(),
            agent_id: None,
            is_registered: false,
        })
    }

    /// Get wallet address
    pub fn address(&self) -> Option<String> {
        self.wallet.as_ref().map(|w| format!("{:?}", w.address()))
    }

    /// Get balances
    pub async fn get_balance(&self) -> Result<BalanceInfo, String> {
        let provider = self.provider.as_ref().ok_or("Provider not initialized")?;
        let wallet = self.wallet.as_ref().ok_or("Wallet not initialized")?;
        
        let eth_balance = provider
            .get_balance(wallet.address(), None)
            .await
            .map_err(|e| format!("Failed to get balance: {}", e))?;
        
        // TODO: Query JEJU token balance, staked amount, pending rewards
        
        Ok(BalanceInfo {
            eth: format!("{}", eth_balance),
            jeju: "0".to_string(),
            staked: "0".to_string(),
            pending_rewards: "0".to_string(),
        })
    }

    /// Sign a message
    pub async fn sign_message(&self, message: &str) -> Result<String, String> {
        let wallet = self.wallet.as_ref().ok_or("Wallet not initialized")?;
        
        let signature = wallet
            .sign_message(message)
            .await
            .map_err(|e| format!("Failed to sign: {}", e))?;
        
        Ok(format!("0x{}", hex::encode(signature.to_vec())))
    }

    /// Send a transaction
    pub async fn send_transaction(
        &self,
        to: &str,
        value: &str,
        data: Option<&str>,
    ) -> Result<TransactionResult, String> {
        let provider = self.provider.as_ref().ok_or("Provider not initialized")?;
        let wallet = self.wallet.as_ref().ok_or("Wallet not initialized")?;
        
        let to_address: Address = to.parse().map_err(|e| format!("Invalid address: {}", e))?;
        let value_wei: U256 = value.parse().map_err(|e| format!("Invalid value: {}", e))?;
        
        let mut tx = TransactionRequest::new()
            .to(to_address)
            .value(value_wei);
        
        if let Some(d) = data {
            let bytes = hex::decode(d.trim_start_matches("0x"))
                .map_err(|e| format!("Invalid data: {}", e))?;
            tx = tx.data(bytes);
        }
        
        // Get gas estimate
        let gas = provider
            .estimate_gas(&tx.clone().into(), None)
            .await
            .map_err(|e| format!("Failed to estimate gas: {}", e))?;
        
        tx = tx.gas(gas);
        
        // Get gas price
        let gas_price = provider
            .get_gas_price()
            .await
            .map_err(|e| format!("Failed to get gas price: {}", e))?;
        
        tx = tx.gas_price(gas_price);
        
        // Sign and send
        let client = SignerMiddleware::new(provider.clone(), wallet.clone());
        
        let pending = client
            .send_transaction(tx, None)
            .await
            .map_err(|e| format!("Failed to send: {}", e))?;
        
        let hash = format!("{:?}", pending.tx_hash());
        
        // Wait for confirmation
        let receipt = pending
            .await
            .map_err(|e| format!("Transaction failed: {}", e))?
            .ok_or("No receipt")?;
        
        Ok(TransactionResult {
            hash,
            status: if receipt.status == Some(U64::from(1)) { "success".to_string() } else { "failed".to_string() },
            block_number: receipt.block_number.map(|b| b.as_u64()),
            gas_used: receipt.gas_used.map(|g| format!("{}", g)),
        })
    }

    fn init_provider(&mut self) -> Result<(), String> {
        let provider = Provider::<Http>::try_from(&self.rpc_url)
            .map_err(|e| format!("Failed to create provider: {}", e))?;
        self.provider = Some(Arc::new(provider));
        Ok(())
    }

    fn encrypt_private_key(&self, wallet: &LocalWallet, password: &str) -> Result<String, String> {
        // Simple encryption using password-derived key
        // In production, use proper key derivation (scrypt/argon2) and AES-GCM
        let key_bytes = wallet.signer().to_bytes();
        let password_hash = Sha256::digest(password.as_bytes());
        
        let encrypted: Vec<u8> = key_bytes
            .iter()
            .zip(password_hash.iter().cycle())
            .map(|(k, p)| k ^ p)
            .collect();
        
        Ok(base64::encode(&encrypted))
    }

    fn decrypt_private_key(&self, encrypted: &str, password: &str) -> Result<String, String> {
        let encrypted_bytes = base64::decode(encrypted)
            .map_err(|e| format!("Invalid encrypted key: {}", e))?;
        
        let password_hash = Sha256::digest(password.as_bytes());
        
        let decrypted: Vec<u8> = encrypted_bytes
            .iter()
            .zip(password_hash.iter().cycle())
            .map(|(e, p)| e ^ p)
            .collect();
        
        Ok(format!("0x{}", hex::encode(&decrypted)))
    }
}

