use alloy::network::{EthereumWallet, TransactionBuilder};
use alloy::primitives::{Address, Bytes, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::Signer;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

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
    signer: Option<PrivateKeySigner>,
    chain_id: u64,
    rpc_url: String,
}

impl WalletManager {
    pub fn new(rpc_url: &str, chain_id: u64) -> Self {
        Self {
            signer: None,
            chain_id,
            rpc_url: rpc_url.to_string(),
        }
    }

    /// Create a new embedded wallet
    pub fn create_wallet(&mut self, password: &str) -> Result<WalletInfo, String> {
        // Generate new wallet using alloy
        let signer = PrivateKeySigner::random();
        let address = format!("{:?}", signer.address());

        // Encrypt private key with password
        let _encrypted = self.encrypt_private_key(&signer, password)?;

        self.signer = Some(signer);

        Ok(WalletInfo {
            address,
            wallet_type: "embedded".to_string(),
            agent_id: None,
            is_registered: false,
        })
    }

    /// Import wallet from private key
    pub fn import_wallet(
        &mut self,
        private_key: &str,
        password: &str,
    ) -> Result<WalletInfo, String> {
        let signer = PrivateKeySigner::from_str(private_key)
            .map_err(|e| format!("Invalid private key: {}", e))?;

        let address = format!("{:?}", signer.address());

        // Encrypt for storage
        let _encrypted = self.encrypt_private_key(&signer, password)?;

        self.signer = Some(signer);

        Ok(WalletInfo {
            address,
            wallet_type: "embedded".to_string(),
            agent_id: None,
            is_registered: false,
        })
    }

    /// Import wallet from mnemonic
    pub fn import_from_mnemonic(
        &mut self,
        mnemonic: &str,
        password: &str,
    ) -> Result<WalletInfo, String> {
        // For mnemonic support, we'd need alloy's mnemonic features
        // For now, derive from mnemonic using standard BIP-39/44 path
        use sha2::{Digest, Sha256};

        // Simple deterministic derivation for demo (in production use proper BIP-39)
        let mut hasher = Sha256::new();
        hasher.update(mnemonic.as_bytes());
        let seed = hasher.finalize();

        let mut key_bytes = [0u8; 32];
        key_bytes.copy_from_slice(&seed[..32]);

        let signer = PrivateKeySigner::from_bytes(&key_bytes.into())
            .map_err(|e| format!("Invalid mnemonic derivation: {}", e))?;

        let address = format!("{:?}", signer.address());

        // Encrypt for storage
        let _encrypted = self.encrypt_private_key(&signer, password)?;

        self.signer = Some(signer);

        Ok(WalletInfo {
            address,
            wallet_type: "embedded".to_string(),
            agent_id: None,
            is_registered: false,
        })
    }

    /// Load encrypted wallet
    #[allow(dead_code)]
    pub fn load_wallet(
        &mut self,
        encrypted_key: &str,
        password: &str,
    ) -> Result<WalletInfo, String> {
        let private_key = self.decrypt_private_key(encrypted_key, password)?;
        self.import_wallet(&private_key, password)
    }

    /// Get wallet info
    pub fn get_info(&self) -> Option<WalletInfo> {
        self.signer.as_ref().map(|s| WalletInfo {
            address: format!("{:?}", s.address()),
            wallet_type: "embedded".to_string(),
            agent_id: None,
            is_registered: false,
        })
    }

    /// Get wallet address
    pub fn address(&self) -> Option<String> {
        self.signer.as_ref().map(|s| format!("{:?}", s.address()))
    }

    /// Get signer for contract interactions
    pub fn get_signer(&self) -> Option<&PrivateKeySigner> {
        self.signer.as_ref()
    }

    /// Get balances.
    /// Balance fetching is now done through ContractClient in commands/wallet.rs.
    /// This method is kept for compatibility but delegates to a simpler implementation.
    #[allow(dead_code)]
    pub async fn get_balance(&self) -> Result<BalanceInfo, String> {
        // Balance fetching is now done through ContractClient
        // This returns empty balances - use ContractClient for actual balances
        Ok(BalanceInfo {
            eth: "0".to_string(),
            jeju: "0".to_string(),
            staked: "0".to_string(),
            pending_rewards: "0".to_string(),
        })
    }

    /// Sign a message
    pub async fn sign_message(&self, message: &str) -> Result<String, String> {
        let signer = self.signer.as_ref().ok_or("Wallet not initialized")?;

        let signature = signer
            .sign_message(message.as_bytes())
            .await
            .map_err(|e| format!("Failed to sign: {}", e))?;

        Ok(format!("0x{}", hex::encode(signature.as_bytes())))
    }

    /// Send a transaction
    pub async fn send_transaction(
        &self,
        to: &str,
        value: &str,
        data: Option<&str>,
    ) -> Result<TransactionResult, String> {
        use alloy::rpc::types::TransactionRequest;

        let signer = self.signer.as_ref().ok_or("Wallet not initialized")?;
        let wallet = EthereumWallet::from(signer.clone());

        let to_address = Address::from_str(to).map_err(|e| format!("Invalid address: {}", e))?;
        let value_wei = U256::from_str(value).map_err(|e| format!("Invalid value: {}", e))?;

        let tx_data: Option<Bytes> = if let Some(d) = data {
            let bytes = hex::decode(d.trim_start_matches("0x"))
                .map_err(|e| format!("Invalid data: {}", e))?;
            Some(Bytes::from(bytes))
        } else {
            None
        };

        let rpc_url: alloy::transports::http::reqwest::Url = self
            .rpc_url
            .parse()
            .map_err(|e| format!("Invalid RPC URL: {}", e))?;

        let provider = ProviderBuilder::new()
            .with_recommended_fillers()
            .wallet(wallet)
            .on_http(rpc_url);

        let mut tx = TransactionRequest::default()
            .with_to(to_address)
            .with_value(value_wei);

        if let Some(input) = tx_data {
            tx = tx.with_input(input);
        }

        let pending = provider
            .send_transaction(tx)
            .await
            .map_err(|e| format!("Failed to send transaction: {}", e))?;

        let tx_hash = pending.tx_hash();

        Ok(TransactionResult {
            hash: format!("{:?}", tx_hash),
            status: "pending".to_string(),
            block_number: None,
            gas_used: None,
        })
    }

    fn encrypt_private_key(
        &self,
        signer: &PrivateKeySigner,
        password: &str,
    ) -> Result<String, String> {
        use rand::RngCore;
        use sha2::Sha256;

        // Generate a random salt (16 bytes) and nonce (12 bytes for AES-GCM)
        let mut salt = [0u8; 16];
        let mut nonce = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut salt);
        rand::thread_rng().fill_bytes(&mut nonce);

        // Derive key using PBKDF2-SHA256 with 100,000 iterations
        let mut derived_key = [0u8; 32];
        pbkdf2::pbkdf2::<hmac::Hmac<Sha256>>(
            password.as_bytes(),
            &salt,
            100_000, // 100k iterations for reasonable security
            &mut derived_key,
        )
        .map_err(|_| "Key derivation failed".to_string())?;

        // Get private key bytes from signer
        let key_bytes = signer.to_bytes();

        // Encrypt using AES-256-GCM
        use aes_gcm::{
            aead::{Aead, KeyInit},
            Aes256Gcm, Nonce,
        };

        let cipher = Aes256Gcm::new_from_slice(&derived_key)
            .map_err(|e| format!("Cipher init failed: {}", e))?;
        let nonce_arr = Nonce::from_slice(&nonce);

        let ciphertext = cipher
            .encrypt(nonce_arr, key_bytes.as_ref())
            .map_err(|e| format!("Encryption failed: {}", e))?;

        // Encode as: salt (16) || nonce (12) || ciphertext (32 + 16 auth tag)
        let mut output = Vec::with_capacity(16 + 12 + ciphertext.len());
        output.extend_from_slice(&salt);
        output.extend_from_slice(&nonce);
        output.extend_from_slice(&ciphertext);

        use base64::{engine::general_purpose, Engine as _};
        Ok(general_purpose::STANDARD.encode(&output))
    }

    fn decrypt_private_key(&self, encrypted: &str, password: &str) -> Result<String, String> {
        use sha2::Sha256;

        use base64::{engine::general_purpose, Engine as _};
        let data = general_purpose::STANDARD
            .decode(encrypted)
            .map_err(|e| format!("Invalid encrypted key format: {}", e))?;

        // Minimum size: 16 (salt) + 12 (nonce) + 32 (key) + 16 (auth tag) = 76 bytes
        if data.len() < 76 {
            return Err("Encrypted data too short".to_string());
        }

        let salt = &data[0..16];
        let nonce = &data[16..28];
        let ciphertext = &data[28..];

        // Derive key using PBKDF2-SHA256 with same parameters
        let mut derived_key = [0u8; 32];
        pbkdf2::pbkdf2::<hmac::Hmac<Sha256>>(password.as_bytes(), salt, 100_000, &mut derived_key)
            .map_err(|_| "Key derivation failed".to_string())?;

        // Decrypt using AES-256-GCM
        use aes_gcm::{
            aead::{Aead, KeyInit},
            Aes256Gcm, Nonce,
        };

        let cipher = Aes256Gcm::new_from_slice(&derived_key)
            .map_err(|e| format!("Cipher init failed: {}", e))?;
        let nonce_arr = Nonce::from_slice(nonce);

        let plaintext = cipher
            .decrypt(nonce_arr, ciphertext)
            .map_err(|_| "Decryption failed - wrong password or corrupted data".to_string())?;

        Ok(format!("0x{}", hex::encode(&plaintext)))
    }
}
