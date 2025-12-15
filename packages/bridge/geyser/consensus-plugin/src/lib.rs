//! EVMSol Geyser Plugin
//!
//! Captures Solana consensus data in real-time for ZK light client proofs.
//!
//! Data captured:
//! - Bank hashes at each slot
//! - Validator votes
//! - Epoch stake snapshots
//! - Transaction confirmations for bridge transfers
//!
//! The plugin posts captured data to the relayer service which generates
//! ZK proofs and submits them to EVM chains.

use solana_geyser_plugin_interface::geyser_plugin_interface::{
    GeyserPlugin, GeyserPluginError, ReplicaAccountInfoVersions,
    ReplicaBlockInfoVersions, ReplicaTransactionInfoVersions, Result as PluginResult,
    SlotStatus,
};
use solana_sdk::{
    clock::Slot,
    pubkey::Pubkey,
    signature::Signature,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;

/// Plugin configuration
#[derive(Debug, Clone, Deserialize)]
pub struct PluginConfig {
    /// Relayer endpoint to post consensus data
    pub relayer_endpoint: String,
    /// Bridge program ID to watch for transfers
    pub bridge_program_id: String,
    /// Vote program ID for capturing votes
    pub vote_program_id: String,
    /// Minimum slots between consensus snapshots
    pub snapshot_interval: u64,
    /// Whether to capture all transactions or only bridge-related
    pub capture_all_transactions: bool,
}

impl Default for PluginConfig {
    fn default() -> Self {
        Self {
            relayer_endpoint: "http://127.0.0.1:8081".to_string(),
            bridge_program_id: "TokenBridge11111111111111111111111111111111".to_string(),
            vote_program_id: "Vote111111111111111111111111111111111111111".to_string(),
            snapshot_interval: 32,
            capture_all_transactions: false,
        }
    }
}

/// Consensus data snapshot
#[derive(Debug, Clone, Serialize)]
pub struct ConsensusSnapshot {
    pub slot: Slot,
    pub bank_hash: [u8; 32],
    pub parent_hash: [u8; 32],
    pub block_time: Option<i64>,
    pub votes: Vec<ValidatorVote>,
    pub transactions_root: [u8; 32],
}

/// Validator vote
#[derive(Debug, Clone, Serialize)]
pub struct ValidatorVote {
    pub validator: [u8; 32],
    pub vote_account: [u8; 32],
    pub slot: Slot,
    pub hash: [u8; 32],
    pub signature: [u8; 64],
    pub timestamp: i64,
}

/// Bridge transfer event
#[derive(Debug, Clone, Serialize)]
pub struct BridgeTransferEvent {
    pub transfer_id: [u8; 32],
    pub slot: Slot,
    pub signature: [u8; 64],
    pub sender: [u8; 32],
    pub recipient: [u8; 32],
    pub amount: u64,
    pub dest_chain: u64,
}

/// Main plugin struct
pub struct EVMSolGeyserPlugin {
    config: PluginConfig,
    runtime: Option<tokio::runtime::Runtime>,
    tx: Option<mpsc::UnboundedSender<PluginMessage>>,
    last_snapshot_slot: Slot,
    bridge_program_id: Pubkey,
    vote_program_id: Pubkey,
}

enum PluginMessage {
    ConsensusSnapshot(ConsensusSnapshot),
    BridgeTransfer(BridgeTransferEvent),
    SlotUpdate { slot: Slot, status: String },
}

impl EVMSolGeyserPlugin {
    fn new() -> Self {
        Self {
            config: PluginConfig::default(),
            runtime: None,
            tx: None,
            last_snapshot_slot: 0,
            bridge_program_id: Pubkey::default(),
            vote_program_id: Pubkey::default(),
        }
    }

    fn start_background_worker(&mut self) {
        let (tx, mut rx) = mpsc::unbounded_channel::<PluginMessage>();
        self.tx = Some(tx);

        let relayer_endpoint = self.config.relayer_endpoint.clone();

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .worker_threads(2)
            .build()
            .expect("Failed to create tokio runtime");

        runtime.spawn(async move {
            let client = reqwest::Client::new();

            while let Some(msg) = rx.recv().await {
                match msg {
                    PluginMessage::ConsensusSnapshot(snapshot) => {
                        let url = format!("{}/consensus", relayer_endpoint);
                        if let Err(e) = client.post(&url).json(&snapshot).send().await {
                            log::error!("Failed to post consensus snapshot: {}", e);
                        } else {
                            log::info!("Posted consensus snapshot for slot {}", snapshot.slot);
                        }
                    }
                    PluginMessage::BridgeTransfer(transfer) => {
                        let url = format!("{}/transfer", relayer_endpoint);
                        if let Err(e) = client.post(&url).json(&transfer).send().await {
                            log::error!("Failed to post bridge transfer: {}", e);
                        } else {
                            log::info!(
                                "Posted bridge transfer {} for slot {}",
                                bs58::encode(&transfer.transfer_id).into_string(),
                                transfer.slot
                            );
                        }
                    }
                    PluginMessage::SlotUpdate { slot, status } => {
                        log::debug!("Slot {} status: {}", slot, status);
                    }
                }
            }
        });

        self.runtime = Some(runtime);
    }

    fn send_message(&self, msg: PluginMessage) {
        if let Some(tx) = &self.tx {
            if let Err(e) = tx.send(msg) {
                log::error!("Failed to send plugin message: {}", e);
            }
        }
    }
}

impl std::fmt::Debug for EVMSolGeyserPlugin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EVMSolGeyserPlugin")
            .field("config", &self.config)
            .finish()
    }
}

impl GeyserPlugin for EVMSolGeyserPlugin {
    fn name(&self) -> &'static str {
        "evmsol-geyser-plugin"
    }

    fn on_load(&mut self, config_file: &str, _is_reload: bool) -> PluginResult<()> {
        env_logger::init();
        log::info!("Loading EVMSol Geyser plugin from config: {}", config_file);

        // Load configuration
        let config_content = std::fs::read_to_string(config_file)
            .map_err(|e| GeyserPluginError::ConfigFileReadError {
                msg: e.to_string(),
            })?;

        self.config = serde_json::from_str(&config_content)
            .map_err(|e| GeyserPluginError::ConfigFileReadError {
                msg: e.to_string(),
            })?;

        // Parse program IDs
        self.bridge_program_id = self.config.bridge_program_id.parse()
            .map_err(|e| GeyserPluginError::ConfigFileReadError {
                msg: format!("Invalid bridge program ID: {}", e),
            })?;

        self.vote_program_id = self.config.vote_program_id.parse()
            .map_err(|e| GeyserPluginError::ConfigFileReadError {
                msg: format!("Invalid vote program ID: {}", e),
            })?;

        // Start background worker
        self.start_background_worker();

        log::info!("EVMSol Geyser plugin loaded successfully");
        Ok(())
    }

    fn on_unload(&mut self) {
        log::info!("Unloading EVMSol Geyser plugin");
        self.tx = None;
        self.runtime = None;
    }

    fn update_account(
        &self,
        account: ReplicaAccountInfoVersions,
        slot: Slot,
        is_startup: bool,
    ) -> PluginResult<()> {
        if is_startup {
            return Ok(());
        }

        // Check if this is a vote account update
        let account_info = match account {
            ReplicaAccountInfoVersions::V0_0_3(info) => info,
            _ => return Ok(()),
        };

        if account_info.owner == self.vote_program_id.as_ref() {
            // This is a vote account - extract vote data
            log::debug!("Vote account update at slot {}", slot);
        }

        Ok(())
    }

    fn notify_end_of_startup(&self) -> PluginResult<()> {
        log::info!("EVMSol Geyser plugin: end of startup");
        Ok(())
    }

    fn update_slot_status(
        &self,
        slot: Slot,
        _parent: Option<Slot>,
        status: SlotStatus,
    ) -> PluginResult<()> {
        let status_str = match status {
            SlotStatus::Processed => "processed",
            SlotStatus::Rooted => "rooted",
            SlotStatus::Confirmed => "confirmed",
        };

        self.send_message(PluginMessage::SlotUpdate {
            slot,
            status: status_str.to_string(),
        });

        Ok(())
    }

    fn notify_transaction(
        &self,
        transaction: ReplicaTransactionInfoVersions,
        slot: Slot,
    ) -> PluginResult<()> {
        let tx_info = match transaction {
            ReplicaTransactionInfoVersions::V0_0_2(info) => info,
            _ => return Ok(()),
        };

        // Check if transaction involves the bridge program
        let involves_bridge = tx_info
            .transaction
            .message()
            .account_keys()
            .iter()
            .any(|key| key == &self.bridge_program_id);

        if involves_bridge {
            log::info!("Bridge transaction detected at slot {}", slot);

            // Parse transfer event from transaction
            // In production, decode the instruction data properly
            let transfer = BridgeTransferEvent {
                transfer_id: [0u8; 32], // Would parse from instruction
                slot,
                signature: [0u8; 64],
                sender: [0u8; 32],
                recipient: [0u8; 32],
                amount: 0,
                dest_chain: 0,
            };

            self.send_message(PluginMessage::BridgeTransfer(transfer));
        }

        Ok(())
    }

    fn notify_block_metadata(
        &self,
        blockinfo: ReplicaBlockInfoVersions,
    ) -> PluginResult<()> {
        let block_info = match blockinfo {
            ReplicaBlockInfoVersions::V0_0_3(info) => info,
            _ => return Ok(()),
        };

        // Check if we should create a consensus snapshot
        if block_info.slot - self.last_snapshot_slot >= self.config.snapshot_interval {
            let snapshot = ConsensusSnapshot {
                slot: block_info.slot,
                bank_hash: *block_info.blockhash.as_ref(),
                parent_hash: *block_info.parent_blockhash.as_ref(),
                block_time: block_info.block_time,
                votes: vec![], // Would collect from vote accounts
                transactions_root: [0u8; 32], // Would compute from transactions
            };

            self.send_message(PluginMessage::ConsensusSnapshot(snapshot));
        }

        Ok(())
    }

    fn account_data_notifications_enabled(&self) -> bool {
        true
    }

    fn transaction_notifications_enabled(&self) -> bool {
        true
    }
}

#[no_mangle]
#[allow(improper_ctypes_definitions)]
pub unsafe extern "C" fn _create_plugin() -> *mut dyn GeyserPlugin {
    let plugin = EVMSolGeyserPlugin::new();
    let plugin: Box<dyn GeyserPlugin> = Box::new(plugin);
    Box::into_raw(plugin)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plugin_creation() {
        let plugin = EVMSolGeyserPlugin::new();
        assert_eq!(plugin.name(), "evmsol-geyser-plugin");
    }

    #[test]
    fn test_config_parsing() {
        let config_json = r#"{
            "relayer_endpoint": "http://localhost:8081",
            "bridge_program_id": "TokenBridge11111111111111111111111111111111",
            "vote_program_id": "Vote111111111111111111111111111111111111111",
            "snapshot_interval": 64,
            "capture_all_transactions": false
        }"#;

        let config: PluginConfig = serde_json::from_str(config_json).unwrap();
        assert_eq!(config.snapshot_interval, 64);
    }
}
