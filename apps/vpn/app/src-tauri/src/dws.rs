//! DWS (Decentralized Web Services) Integration
//!
//! Integrates VPN with Jeju's DWS for:
//! - Static asset caching and serving
//! - Edge CDN functionality
//! - Decentralized storage access
//! - Premium content delivery

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// DWS configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DWSConfig {
    /// DWS gateway URL
    pub gateway_url: String,

    /// Storage cache size in MB
    pub cache_size_mb: u64,

    /// Enable static asset serving
    pub serve_static: bool,

    /// Enable edge caching
    pub edge_cache: bool,

    /// Priority content CIDs to cache
    pub priority_cids: Vec<String>,
}

impl Default for DWSConfig {
    fn default() -> Self {
        Self {
            gateway_url: "https://dws.jejunetwork.org".to_string(),
            cache_size_mb: 1024, // 1GB default cache
            serve_static: true,
            edge_cache: true,
            priority_cids: vec![],
        }
    }
}

/// DWS service state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DWSState {
    /// Is DWS service active
    pub active: bool,

    /// Cache usage in MB
    pub cache_used_mb: u64,

    /// Total bytes served
    pub bytes_served: u64,

    /// Total requests served
    pub requests_served: u64,

    /// Active cached CIDs
    pub cached_cids: u64,

    /// Earnings from DWS serving (in wei)
    pub earnings_wei: u64,
}

/// Cached content item
#[derive(Debug, Clone)]
struct CachedItem {
    cid: String,
    size_bytes: u64,
    last_accessed: u64,
    access_count: u64,
    priority: u8,
    /// Actual cached content bytes
    data: Vec<u8>,
}

/// DWS integration manager
pub struct DWSManager {
    config: DWSConfig,
    state: Arc<RwLock<DWSState>>,
    cache: Arc<RwLock<HashMap<String, CachedItem>>>,
    running: bool,
}

impl DWSManager {
    pub fn new(config: DWSConfig) -> Self {
        Self {
            config,
            state: Arc::new(RwLock::new(DWSState {
                active: false,
                cache_used_mb: 0,
                bytes_served: 0,
                requests_served: 0,
                cached_cids: 0,
                earnings_wei: 0,
            })),
            cache: Arc::new(RwLock::new(HashMap::new())),
            running: false,
        }
    }

    /// Start DWS service
    pub async fn start(&mut self) -> Result<(), String> {
        if self.running {
            return Ok(());
        }

        self.running = true;
        self.state.write().await.active = true;

        // Pre-cache priority content
        for cid in &self.config.priority_cids.clone() {
            let _ = self.cache_content(cid).await;
        }

        tracing::info!(
            "DWS service started with {}MB cache",
            self.config.cache_size_mb
        );
        Ok(())
    }

    /// Stop DWS service
    pub async fn stop(&mut self) {
        self.running = false;
        self.state.write().await.active = false;
        tracing::info!("DWS service stopped");
    }

    /// Cache content by CID
    pub async fn cache_content(&self, cid: &str) -> Result<(), String> {
        // Check cache limit
        let state = self.state.read().await;
        if state.cache_used_mb >= self.config.cache_size_mb {
            // Evict LRU content
            drop(state);
            self.evict_lru().await;
        } else {
            drop(state);
        }

        // Fetch from DWS gateway
        let url = format!("{}/ipfs/{}", self.config.gateway_url, cid);
        let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;

        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        let size_bytes = bytes.len() as u64;
        let data = bytes.to_vec();

        // Store in cache with actual content
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let item = CachedItem {
            cid: cid.to_string(),
            size_bytes,
            last_accessed: now,
            access_count: 0,
            priority: if self.config.priority_cids.contains(&cid.to_string()) {
                10
            } else {
                0
            },
            data,
        };

        self.cache.write().await.insert(cid.to_string(), item);

        // Update state
        let mut state = self.state.write().await;
        state.cache_used_mb += size_bytes / 1_000_000;
        state.cached_cids += 1;

        tracing::debug!("Cached {} ({} bytes)", cid, size_bytes);
        Ok(())
    }

    /// Serve content from cache
    ///
    /// Returns the cached content bytes if available, None if not cached.
    pub async fn serve_content(&self, cid: &str) -> Option<Vec<u8>> {
        let mut cache = self.cache.write().await;

        if let Some(item) = cache.get_mut(cid) {
            // Update access stats
            item.last_accessed = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            item.access_count += 1;

            // Clone the data before releasing the lock
            let data = item.data.clone();
            let size = item.size_bytes;

            // Update state
            let mut state = self.state.write().await;
            state.bytes_served += size;
            state.requests_served += 1;

            tracing::debug!("Cache hit for {} ({} bytes)", cid, size);
            return Some(data);
        }

        None
    }

    /// Check if content is cached
    pub async fn is_cached(&self, cid: &str) -> bool {
        self.cache.read().await.contains_key(cid)
    }

    /// Get service state
    pub async fn get_state(&self) -> DWSState {
        self.state.read().await.clone()
    }

    /// Evict least recently used content
    async fn evict_lru(&self) {
        let mut cache = self.cache.write().await;

        // Find item with lowest priority and oldest access
        let evict_cid = cache
            .iter()
            .filter(|(_, item)| item.priority == 0) // Don't evict priority content
            .min_by_key(|(_, item)| (item.priority, item.last_accessed))
            .map(|(cid, _)| cid.clone());

        if let Some(cid) = evict_cid {
            if let Some(item) = cache.remove(&cid) {
                let mut state = self.state.write().await;
                state.cache_used_mb = state
                    .cache_used_mb
                    .saturating_sub(item.size_bytes / 1_000_000);
                state.cached_cids = state.cached_cids.saturating_sub(1);
                tracing::debug!("Evicted {} from cache", cid);
            }
        }
    }

    /// Record earnings from serving content
    pub async fn record_earnings(&self, wei: u64) {
        self.state.write().await.earnings_wei += wei;
    }
}

impl Default for DWSManager {
    fn default() -> Self {
        Self::new(DWSConfig::default())
    }
}
