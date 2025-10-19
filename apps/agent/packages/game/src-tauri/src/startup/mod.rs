use crate::backend::{BackendError, BackendResult, ContainerRuntimeType};
use crate::common::{AGENT_CONTAINER, OLLAMA_CONTAINER, POSTGRES_CONTAINER};
use crate::container::{ContainerManager, RuntimeDetectionStatus};
use std::env;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tracing::{error, info, warn};

mod memory;
pub use memory::{ContainerMemoryLimits, MemoryConfig};

#[derive(Debug, Clone)]
#[allow(clippy::enum_variant_names)]
enum OllamaStatus {
    ContainerizedRunning, // Our containerized Ollama on port 17777
    NativeRunning,        // Native Ollama installation on port 11434
    NotRunning,           // No Ollama found
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupStatus {
    pub stage: StartupStage,
    pub progress: u8, // 0-100
    pub message: String,
    pub details: String,
    pub can_retry: bool,
    pub runtime_status: Option<RuntimeDetectionStatus>,
    pub container_statuses: std::collections::HashMap<String, String>,
    pub game_api_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StartupStage {
    Initializing,
    DetectingRuntime,
    RuntimeDetected,
    PromptingConfig,
    ConfigReceived,
    InitializingContainers,
    StartingDatabase,
    StartingOllama,
    DownloadingModels,
    StartingAgent,
    WaitingForHealth,
    ContainersReady,
    StartingMessageServer,
    MessageServerReady,
    VerifyingGameAPI,
    GameAPIReady,
    RunningTests,
    Ready,
    Error,
}

pub struct StartupManager {
    app_handle: AppHandle,
    status: Arc<Mutex<StartupStatus>>,
    container_manager: Option<Arc<ContainerManager>>,
    config: Option<UserConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserConfig {
    pub ai_provider: AiProvider,
    pub api_key: Option<String>,
    pub use_local_ollama: bool,
    pub postgres_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AiProvider {
    Ollama,
    OpenAI,
    Anthropic,
}

impl StartupManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let initial_status = StartupStatus {
            stage: StartupStage::Initializing,
            progress: 0,
            message: "Initializing ELIZA Game...".to_string(),
            details: "Starting up backend services".to_string(),
            can_retry: false,
            runtime_status: None,
            container_statuses: std::collections::HashMap::new(),
            game_api_ready: false,
        };

        Self {
            app_handle,
            status: Arc::new(Mutex::new(initial_status)),
            container_manager: None,
            config: None,
        }
    }

    pub async fn start_initialization(
        &mut self,
        resource_dir: std::path::PathBuf,
    ) -> BackendResult<()> {
        info!("🚀 Starting ELIZA Game initialization sequence");

        // If ELIZA_EXTERNAL_AGENT is set, skip container orchestration and rely on external dev server
        let use_external_agent = env::var("ELIZA_EXTERNAL_AGENT")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if use_external_agent {
            self.update_status(
                StartupStage::Initializing,
                5,
                "Using external agent server (dev)",
                "Skipping container orchestration; waiting for http://localhost:7777",
            )
            .await;

            let client = reqwest::Client::new();
            let mut attempts = 0u32;
            let max_attempts = 120u32; // up to ~120s
            loop {
                attempts += 1;
                match client
                    .get("http://localhost:7777/api/server/health")
                    .timeout(std::time::Duration::from_secs(2))
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => {
                        self.update_status(
                            StartupStage::GameAPIReady,
                            95,
                            "Agent API is ready",
                            "Connected to external dev agent",
                        )
                        .await;
                        let mut status = self.status.lock().unwrap();
                        status.game_api_ready = true;
                        drop(status);
                        self.update_status(
                            StartupStage::Ready,
                            100,
                            "Startup complete",
                            "Running with external agent (compose)",
                        )
                        .await;
                        return Ok(());
                    }
                    _ => {
                        if attempts >= max_attempts {
                            self.update_status(
                                StartupStage::Error,
                                0,
                                "Agent API did not become healthy",
                                "Ensure 'npm run dev' started the compose stack",
                            )
                            .await;
                            return Err(BackendError::Container(
                                "External agent not reachable on http://localhost:7777".to_string(),
                            ));
                        }
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    }
                }
            }
        }

        // Clean up any orphaned containers from previous runs
        self.update_status(
            StartupStage::Initializing,
            2,
            "Cleaning up...",
            "Checking for orphaned containers from previous runs",
        )
        .await;

        if let Err(e) = self.cleanup_orphaned_containers(&resource_dir).await {
            warn!("Failed to cleanup orphaned containers: {}", e);
            // Continue anyway - this is not critical
        }

        // First check if ElizaOS server is already running
        let mut server_healthy = false;
        let mut recovery_attempted = false;

        // Try up to 2 times: first check, then recovery + check
        for attempt in 0..2 {
            match self.check_existing_server().await {
                Ok(true) => {
                    server_healthy = true;
                    break;
                }
                Ok(false) | Err(_) => {
                    if attempt == 0 && !recovery_attempted {
                        // First attempt failed, try recovery
                        warn!("⚠️ ElizaOS server not responding, attempting recovery...");

                        // Ensure we have Podman ready first
                        self.update_status(
                            StartupStage::DetectingRuntime,
                            5,
                            "Ensuring container runtime is ready for recovery...",
                            "Checking Podman status",
                        )
                        .await;

                        if let Err(e) = self.ensure_podman_ready().await {
                            error!("Podman setup failed during recovery: {}", e);
                            // Continue to normal startup flow
                            break;
                        }

                        // Initialize container manager for recovery if not already done
                        if self.container_manager.is_none() {
                            match ContainerManager::new_with_runtime_manager(
                                ContainerRuntimeType::Podman,
                                resource_dir.clone(),
                            )
                            .await
                            {
                                Ok(mut manager) => {
                                    manager.set_app_handle(self.app_handle.clone());

                                    // Calculate and set memory limits based on system resources
                                    let memory_config = MemoryConfig::calculate();
                                    if memory_config.has_sufficient_memory {
                                        let container_limits = memory_config.get_container_limits();
                                        manager.set_memory_limits(container_limits);
                                    }

                                    self.container_manager = Some(Arc::new(manager));
                                }
                                Err(e) => {
                                    error!(
                                        "Failed to create container manager for recovery: {}",
                                        e
                                    );
                                    // Continue to normal startup
                                    break;
                                }
                            }
                        }

                        // Attempt recovery
                        if let Err(e) = self.recover_elizaos_server().await {
                            error!("Recovery failed: {}", e);
                            // Continue to normal startup
                            break;
                        }

                        recovery_attempted = true;
                        // Wait a bit for the server to stabilize after recovery
                        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

                        // Loop will retry the health check
                    } else {
                        // Recovery already attempted or second check failed
                        break;
                    }
                }
            }
        }

        if server_healthy {
            info!("✅ Found healthy ElizaOS server - checking Ollama status");

            // Even with existing server, we need to ensure Ollama is running
            self.update_status(
                StartupStage::DetectingRuntime,
                10,
                "Checking container runtime...",
                "Ensuring Podman and Ollama are ready",
            )
            .await;

            // Ensure Podman is ready
            if let Err(e) = self.ensure_podman_ready().await {
                error!("Podman setup failed: {}", e);
                self.update_status(
                    StartupStage::Error,
                    0,
                    "Podman setup failed",
                    &format!(
                        "Please run 'podman machine start' and try again. Error: {}",
                        e
                    ),
                )
                .await;
                return Err(e);
            }

            // Initialize container manager if needed
            if self.container_manager.is_none() {
                match ContainerManager::new_with_runtime_manager(
                    ContainerRuntimeType::Podman,
                    resource_dir.clone(),
                )
                .await
                {
                    Ok(mut manager) => {
                        manager.set_app_handle(self.app_handle.clone());

                        // Calculate and set memory limits based on system resources
                        let memory_config = MemoryConfig::calculate();
                        if memory_config.has_sufficient_memory {
                            let container_limits = memory_config.get_container_limits();
                            manager.set_memory_limits(container_limits);
                        }

                        self.container_manager = Some(Arc::new(manager));
                    }
                    Err(e) => {
                        error!("Failed to create container manager: {}", e);
                        self.update_status(
                            StartupStage::Error,
                            0,
                            "Container runtime initialization failed",
                            &format!("Error: {}", e),
                        )
                        .await;
                        return Err(e);
                    }
                }
            }

            // Check and start Ollama if needed
            self.update_status(
                StartupStage::StartingOllama,
                40,
                "Checking Ollama status...",
                "Ensuring AI model server is running",
            )
            .await;

            // Check current Ollama status
            let ollama_status = self.check_ollama_status().await?;

            match ollama_status {
                OllamaStatus::ContainerizedRunning => {
                    info!("✅ Our containerized Ollama is already running on eliza-network");
                    // Ensure we use containerized path
                    if let Some(manager) = &self.container_manager {
                        let _ = manager.set_use_native_ollama(false).await;
                    }
                }
                OllamaStatus::NativeRunning | OllamaStatus::NotRunning => {
                    let status_msg = match ollama_status {
                        OllamaStatus::NativeRunning => "Found native Ollama on port 11434",
                        _ => "No Ollama detected",
                    };

                    info!("🔍 {}", status_msg);
                    // Prefer native on macOS; if not running, attempt to start via Homebrew
                    #[cfg(target_os = "macos")]
                    {
                        if let Some(manager) = &self.container_manager {
                            // If native is not running, try to start it via brew
                            if matches!(ollama_status, OllamaStatus::NotRunning) {
                                self.update_status(
                                    StartupStage::StartingOllama,
                                    42,
                                    "Starting native Ollama...",
                                    "Using Homebrew to start ollama service",
                                )
                                .await;

                                let brew_paths = [
                                    "/opt/homebrew/bin/brew",
                                    "/usr/local/bin/brew",
                                ];

                                let mut brew_found = None;
                                for p in brew_paths { if std::path::Path::new(p).exists() { brew_found = Some(p); break; } }

                                if let Some(brew) = brew_found {
                                    // Try install if missing
                                    let _ = std::process::Command::new(brew)
                                        .args(["list", "ollama"]).output();
                                    // Start service (install happens on demand if needed by the user later)
                                    let _ = std::process::Command::new(brew)
                                        .args(["services", "start", "ollama"]).output();

                                    // Wait briefly for health
                                    let client = reqwest::Client::new();
                                    for _ in 0..10u8 {
                                        if let Ok(resp) = client.get("http://localhost:11434/api/version").timeout(std::time::Duration::from_secs(2)).send().await {
                                            if resp.status().is_success() { break; }
                                        }
                                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                                    }

                                    // Mark to use native and set port
                                    let _ = manager.set_use_native_ollama(true).await;
                                    manager.update_port_config(crate::container::manager::PortConfig { postgres_port: manager.get_port_config().await.postgres_port, ollama_port: 11434, agent_port: manager.get_port_config().await.agent_port }).await;

                                    info!("✅ Using native Ollama on macOS");
                                } else {
                                    info!("Homebrew not found; will start containerized Ollama");
                                }
                            } else {
                                // Native already running
                                let _ = manager.set_use_native_ollama(true).await;
                                manager.update_port_config(crate::container::manager::PortConfig { postgres_port: manager.get_port_config().await.postgres_port, ollama_port: 11434, agent_port: manager.get_port_config().await.agent_port }).await;
                                info!("✅ Using native Ollama on macOS");
                            }
                        }
                    }

                    // If not macOS or native not available, start containerized Ollama
                    #[cfg(not(target_os = "macos"))]
                    info!("🚀 Starting our containerized Ollama on eliza-network");
                    #[cfg(target_os = "macos")]
                    if !matches!(ollama_status, OllamaStatus::NativeRunning) {
                        info!("🚀 Starting our containerized Ollama on eliza-network");
                    }

                    if let Some(manager) = &self.container_manager {
                        // Create network if it doesn't exist
                        if let Err(e) = manager
                            .ensure_network_exists(crate::common::NETWORK_NAME)
                            .await
                        {
                            warn!("Failed to ensure network exists: {}", e);
                        }

                        // Check if we need to clean up existing Ollama container
                        match manager.get_container_status(OLLAMA_CONTAINER).await {
                            Ok(status) => {
                                if !matches!(status.health, crate::backend::HealthStatus::Healthy) {
                                    warn!(
                                        "Found unhealthy Ollama container, attempting cleanup..."
                                    );
                                    if let Err(e) = manager.stop_container(OLLAMA_CONTAINER).await {
                                        warn!("Failed to stop unhealthy Ollama: {}", e);
                                    }
                                    // Wait a bit for cleanup
                                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                                }
                            }
                            Err(_) => {
                                // No container exists, which is fine
                            }
                        }

                        // Start our Ollama on eliza-network when not using native
                        let use_native = manager.is_use_native_ollama().await;
                        match if use_native { Ok(crate::backend::ContainerStatus { id: String::new(), name: OLLAMA_CONTAINER.to_string(), state: crate::backend::ContainerState::Stopped, health: crate::backend::HealthStatus::Unknown, ports: vec![], started_at: None, uptime_seconds: 0, restart_count: 0 }) } else { manager.start_ollama().await } {
                            Ok(_) => {
                                info!(
                                    "✅ Containerized Ollama started successfully on eliza-network"
                                );

                                // Wait for health check with retries
                                let mut health_check_attempts = 0;
                                let max_attempts = 3;
                                let mut ollama_healthy = false;

                                while !manager.is_use_native_ollama().await && health_check_attempts < max_attempts && !ollama_healthy {
                                    health_check_attempts += 1;
                                    info!(
                                        "Waiting for Ollama health check (attempt {}/{})",
                                        health_check_attempts, max_attempts
                                    );

                                    match manager
                                        .wait_for_container_health(
                                            OLLAMA_CONTAINER,
                                            std::time::Duration::from_secs(90),
                                        )
                                        .await
                                    {
                                        Ok(_) => {
                                            ollama_healthy = true;
                                        }
                                        Err(e) => {
                                            warn!(
                                                "Ollama health check failed (attempt {}): {}",
                                                health_check_attempts, e
                                            );

                                            if health_check_attempts < max_attempts {
                                                // Try to diagnose the issue
                                                info!("Attempting to diagnose Ollama startup issue...");

                                                // Check if the container is actually running
                                                if let Ok(status) = manager
                                                    .get_container_status(OLLAMA_CONTAINER)
                                                    .await
                                                {
                                                    info!("Ollama container state: {:?}, health: {:?}", status.state, status.health);

                                                    // If container crashed, try to restart
                                                    if matches!(
                                                        status.state,
                                                        crate::backend::ContainerState::Stopped
                                                            | crate::backend::ContainerState::Error
                                                    ) {
                                                        warn!("Ollama container crashed, attempting restart...");
                                                        if let Err(e) = manager
                                                            .restart_container(OLLAMA_CONTAINER)
                                                            .await
                                                        {
                                                            error!(
                                                                "Failed to restart Ollama: {}",
                                                                e
                                                            );
                                                        }
                                                    }
                                                }

                                                // Wait before retry
                                                tokio::time::sleep(
                                                    tokio::time::Duration::from_secs(5),
                                                )
                                                .await;
                                            }
                                        }
                                    }
                                }

                                if !ollama_healthy {
                                    // Try direct health check as a fallback
                                    info!(
                                        "Container health check failed, trying direct API check..."
                                    );
                                    match manager.check_ollama_health_direct().await {
                                        Ok(true) => {
                                            info!("✅ Direct Ollama health check passed, continuing despite container health check failure");
                                        }
                                        _ => {
                                            error!(
                                                "Ollama failed to become healthy after {} attempts",
                                                max_attempts
                                            );
                                            self.update_status(
                                                StartupStage::Error,
                                                0,
                                                "Ollama startup failed",
                                                "Failed to start AI model server. Try restarting the application.",
                                            )
                                            .await;
                                            return Err(BackendError::Container("Ollama health check failed after multiple attempts".to_string()));
                                        }
                                    }
                                }

                                // Pull models
                                self.update_status(
                                    StartupStage::DownloadingModels,
                                    60,
                                    "Downloading AI models...",
                                    "Pulling required models for agent operation",
                                )
                                .await;

                                if let Err(e) = manager.pull_ollama_models().await {
                                    error!("Failed to pull Ollama models: {}", e);
                                    warn!("⚠️ Some models may not be available: {}", e);
                                }
                            }
                            Err(e) => {
                                error!("Failed to start Ollama: {}", e);
                                self.update_status(
                                    StartupStage::Error,
                                    0,
                                    "Ollama startup failed",
                                    &format!("Failed to start AI model server: {}", e),
                                )
                                .await;
                                return Err(e);
                            }
                        }
                    }
                }
            }

            // Now we're ready with existing server + Ollama
            self.update_status(
                StartupStage::VerifyingGameAPI,
                90,
                "Verifying Game API...",
                "Checking Game API plugin connectivity",
            )
            .await;

            // Verify Game API is ready
            match self.verify_game_api().await {
                Ok(true) => {
                    self.update_status(
                        StartupStage::Ready,
                        100,
                        "Ready to use ELIZA",
                        "Connected to existing ElizaOS server with Game API",
                    )
                    .await;
                }
                Ok(false) => {
                    self.update_status(
                        StartupStage::Error,
                        0,
                        "Game API not available",
                        "ElizaOS server is running but Game API plugin is not responding. Chat will be disabled.",
                    )
                    .await;

                    return Err(BackendError::Container(
                        "Game API plugin not available".to_string(),
                    ));
                }
                Err(e) => {
                    self.update_status(
                        StartupStage::Error,
                        0,
                        "Game API verification error",
                        &format!("Failed to verify Game API: {}", e),
                    )
                    .await;

                    return Err(e);
                }
            }

            return Ok(());
        }

        // If no existing server, we must start containers - ensure Podman is ready
        self.update_status(
            StartupStage::DetectingRuntime,
            5,
            "Checking Podman machine status...",
            "Ensuring container runtime is ready",
        )
        .await;

        if let Err(e) = self.ensure_podman_ready().await {
            error!("Podman setup failed: {}", e);
            self.update_status(
                StartupStage::Error,
                0,
                "Podman setup failed",
                &format!(
                    "Please run 'podman machine start' and try again. Error: {}",
                    e
                ),
            )
            .await;
            return Err(e);
        }

        // Stage 1: Runtime Detection (only if no existing server)
        self.update_status(
            StartupStage::DetectingRuntime,
            10,
            "Detecting container runtime...",
            "Checking for Podman, Docker, or downloading runtime",
        )
        .await;

        match ContainerManager::new_with_runtime_manager(ContainerRuntimeType::Podman, resource_dir)
            .await
        {
            Ok(mut manager) => {
                // Set the app handle for event emission
                manager.set_app_handle(self.app_handle.clone());

                // Calculate and set memory limits based on system resources
                let memory_config = MemoryConfig::calculate();
                if memory_config.has_sufficient_memory {
                    let container_limits = memory_config.get_container_limits();
                    manager.set_memory_limits(container_limits);
                }

                self.container_manager = Some(Arc::new(manager));
                self.update_status(
                    StartupStage::RuntimeDetected,
                    20,
                    "Container runtime detected successfully",
                    "Ready to configure containers",
                )
                .await;
            }
            Err(e) => {
                error!("Failed to detect container runtime: {}", e);
                self.update_status(
                    StartupStage::Error,
                    0,
                    "Container runtime detection failed",
                    &format!("Error: {}", e),
                )
                .await;
                return Err(e);
            }
        }

        // Stage 2: Use default configuration to avoid getting stuck
        self.update_status(
            StartupStage::PromptingConfig,
            25,
            "Using default configuration...",
            "Applying default AI provider and container settings",
        )
        .await;

        // Use default configuration instead of waiting for user input
        let default_config = UserConfig {
            ai_provider: AiProvider::Ollama,
            api_key: None,
            use_local_ollama: true,
            postgres_enabled: true,
        };

        // Automatically proceed with default configuration
        self.handle_user_config(default_config).await?;

        Ok(())
    }

    pub async fn handle_user_config(&mut self, config: UserConfig) -> BackendResult<()> {
        info!("📝 Received user configuration: {:?}", config);
        self.config = Some(config.clone());

        self.update_status(
            StartupStage::ConfigReceived,
            30,
            "Configuration received",
            "Starting container setup...",
        )
        .await;

        // Stage 3: Ensure agent image is available before setting up containers
        self.update_status(
            StartupStage::InitializingContainers,
            35,
            "Ensuring agent image is available...",
            "Building container image if needed",
        )
        .await;

        self.ensure_agentserver_image().await?;

        // Stage 4: Setup containers based on config
        self.setup_containers().await?;

        Ok(())
    }

    async fn check_existing_server(&self) -> BackendResult<bool> {
        info!("🔍 Checking for existing ElizaOS server on port 7777...");

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|e| BackendError::Container(format!("Failed to create HTTP client: {}", e)))?;

        // First try a simple ping to avoid rate limiting
        match client.get("http://localhost:7777/api/ping").send().await {
            Ok(response) if response.status().is_success() => {
                // Server is responding, now check full health
                match client
                    .get("http://localhost:7777/api/server/health")
                    .send()
                    .await
                {
                    Ok(health_response) if health_response.status().is_success() => {
                        info!("📡 Server responded with status: 200 OK");

                        match health_response.json::<serde_json::Value>().await {
                            Ok(health_data) => {
                                info!(
                                    "🔍 Health data received: {}",
                                    serde_json::to_string(&health_data).unwrap_or_default()
                                );

                                // Check if the server is actually ready
                                if let Some(ready) = health_data["data"]["ready"].as_bool() {
                                    if ready {
                                        info!("✅ ElizaOS server is healthy and ready");
                                        return Ok(true);
                                    } else {
                                        warn!("⚠️ ElizaOS server is running but not ready yet");
                                        return Ok(false);
                                    }
                                }
                            }
                            Err(e) => {
                                warn!("⚠️ Failed to parse health response: {}", e);
                                return Ok(false);
                            }
                        }
                    }
                    Ok(response) if response.status().as_u16() == 429 => {
                        warn!("⚠️ Rate limited when checking server health, assuming server is running");
                        // If we're rate limited, the server is definitely running
                        return Ok(true);
                    }
                    Ok(response) => {
                        warn!(
                            "⚠️ Server health check returned status: {}",
                            response.status()
                        );
                        return Ok(false);
                    }
                    Err(e) => {
                        warn!("⚠️ Failed to check server health: {}", e);
                        return Ok(false);
                    }
                }

                Ok(true)
            }
            Ok(response) if response.status().as_u16() == 429 => {
                warn!("⚠️ Rate limited when pinging server, assuming server is running");
                // If we're rate limited, the server is definitely running
                Ok(true)
            }
            Ok(response) => {
                info!(
                    "📡 Server responded with non-success status: {}",
                    response.status()
                );
                Ok(false)
            }
            Err(e) => {
                info!("🔍 No response from ElizaOS server: {}", e);
                Ok(false)
            }
        }
    }

    /// Performs aggressive recovery when ElizaOS server is not responding
    /// This kills any process on the agent port and cleans up eliza-agent containers
    async fn recover_elizaos_server(&self) -> BackendResult<()> {
        warn!("🔧 Starting ElizaOS server recovery process...");

        // Ensure we have container manager
        let manager = self.container_manager.as_ref().ok_or_else(|| {
            BackendError::Container("Container manager not initialized for recovery".to_string())
        })?;

        // Step 1: Check container statuses
        info!("📊 Checking container statuses...");
        let mut recovery_actions = vec![];

        // Check each critical container
        for container_name in &[POSTGRES_CONTAINER, OLLAMA_CONTAINER, AGENT_CONTAINER] {
            match manager.get_container_status(container_name).await {
                Ok(status) => {
                    match status.state {
                        crate::backend::ContainerState::Stopped => {
                            recovery_actions.push(format!("restart:{}", container_name));
                        }
                        crate::backend::ContainerState::Error => {
                            recovery_actions.push(format!("recreate:{}", container_name));
                        }
                        crate::backend::ContainerState::Running => {
                            // Check health status
                            if !matches!(status.health, crate::backend::HealthStatus::Healthy) {
                                recovery_actions.push(format!("health:{}", container_name));
                            }
                        }
                        _ => {}
                    }
                }
                Err(_) => {
                    // Container doesn't exist
                    recovery_actions.push(format!("create:{}", container_name));
                }
            }
        }

        // Step 2: Execute recovery actions
        for action in recovery_actions {
            let parts: Vec<&str> = action.split(':').collect();
            if parts.len() != 2 {
                continue;
            }

            let action_type = parts[0];
            let container_name = parts[1];

            match action_type {
                "restart" => {
                    info!("🔄 Restarting container: {}", container_name);
                    if let Err(e) = manager.restart_container(container_name).await {
                        warn!("Failed to restart {}: {}", container_name, e);
                    }
                }
                "recreate" => {
                    info!("🔨 Recreating container: {}", container_name);
                    // Stop and remove the container first
                    let _ = manager.stop_container(container_name).await;
                    let _ = manager.remove_container(container_name).await;

                    // Recreate based on container type
                    match container_name {
                        POSTGRES_CONTAINER => {
                            // Find available ports and update configuration
                            let available_ports = crate::container::manager::PortConfig::find_available_ports().await;
                            manager.update_port_config(available_ports).await;
                            
                            // Ensure network exists before starting postgres
                            if let Err(e) = manager.ensure_network_exists(crate::common::NETWORK_NAME).await {
                                error!("Failed to ensure network exists for postgres recreation: {}", e);
                            } else if let Err(e) = manager.start_postgres().await {
                                error!("Failed to recreate postgres: {}", e);
                            }
                        }
                        OLLAMA_CONTAINER => {
                            if let Err(e) = manager.start_ollama().await {
                                error!("Failed to recreate ollama: {}", e);
                            }
                        }
                        AGENT_CONTAINER => {
                            // Agent container recreation is more complex, skip for now
                            warn!("Agent container recreation not implemented in recovery");
                        }
                        _ => {}
                    }
                }
                "create" => {
                    info!("➕ Creating missing container: {}", container_name);
                    match container_name {
                        POSTGRES_CONTAINER => {
                            // Find available ports and update configuration
                            let available_ports = crate::container::manager::PortConfig::find_available_ports().await;
                            manager.update_port_config(available_ports).await;
                            
                            // Ensure network exists before starting postgres
                            if let Err(e) = manager.ensure_network_exists(crate::common::NETWORK_NAME).await {
                                error!("Failed to ensure network exists for postgres creation: {}", e);
                            } else if let Err(e) = manager.start_postgres().await {
                                error!("Failed to create postgres: {}", e);
                            }
                        }
                        OLLAMA_CONTAINER => {
                            if let Err(e) = manager.start_ollama().await {
                                error!("Failed to create ollama: {}", e);
                            }
                        }
                        _ => {}
                    }
                }
                "health" => {
                    info!(
                        "🏥 Waiting for container to become healthy: {}",
                        container_name
                    );
                    // Just wait a bit more for health
                    if let Err(e) = manager
                        .wait_for_container_health(
                            container_name,
                            std::time::Duration::from_secs(30),
                        )
                        .await
                    {
                        warn!(
                            "Container {} still unhealthy after wait: {}",
                            container_name, e
                        );
                    }
                }
                _ => {}
            }
        }

        // Step 3: Wait for services to stabilize
        info!("⏳ Waiting for services to stabilize...");
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

        // Step 4: Verify recovery
        match self.check_existing_server().await {
            Ok(true) => {
                info!("✅ Recovery successful - ElizaOS server is now healthy");
                Ok(())
            }
            _ => {
                warn!("⚠️ Recovery completed but server still not healthy");
                // Don't fail - let normal startup continue
                Ok(())
            }
        }
    }

    async fn check_ollama_status(&self) -> BackendResult<OllamaStatus> {
        info!("🔍 Checking Ollama availability...");

        // Check if our containerized Ollama is running
        if let Some(manager) = &self.container_manager {
            match manager.get_container_status(OLLAMA_CONTAINER).await {
                Ok(status) if matches!(status.health, crate::backend::HealthStatus::Healthy) => {
                    info!("✅ Found containerized Ollama (eliza-ollama) running and healthy");
                    return Ok(OllamaStatus::ContainerizedRunning);
                }
                Ok(status) => {
                    info!(
                        "📍 Found eliza-ollama container but it's not healthy: {:?}",
                        status.health
                    );
                }
                Err(e) => {
                    info!("📍 No eliza-ollama container found: {}", e);
                }
            }
        }

        // Check if native Ollama is running on default port
        let client = reqwest::Client::new();
        match client
            .get("http://localhost:11434/api/version")
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                info!("🔍 Found Ollama on port 11434 (could be native or another container)");
                // We still need our own container for network isolation
                return Ok(OllamaStatus::NativeRunning);
            }
            _ => {
                info!("❌ No Ollama service found");
            }
        }

        Ok(OllamaStatus::NotRunning)
    }

    async fn verify_game_api(&self) -> BackendResult<bool> {
        info!("🎮 Verifying Game API plugin connectivity...");

        // Get the current port configuration
        let agent_port = if let Some(manager) = &self.container_manager {
            let port_config = manager.get_port_config().await;
            port_config.agent_port
        } else {
            7777 // Default fallback
        };

        let client = reqwest::Client::new();
        let max_attempts = 10;
        let initial_delay_secs = 2; // Start with 2 seconds
        let max_delay_secs = 30; // Cap at 30 seconds

        for attempt in 0..max_attempts {
            // Calculate exponential backoff delay
            let delay_secs = if attempt == 0 {
                0 // No delay on first attempt
            } else {
                let exponential_delay =
                    initial_delay_secs * (2_u64).pow((attempt - 1).min(5) as u32);
                exponential_delay.min(max_delay_secs)
            };

            if delay_secs > 0 {
                info!("⏳ Waiting {} seconds before next attempt...", delay_secs);
                tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;
            }

            self.update_status(
                StartupStage::VerifyingGameAPI,
                95 + (attempt * 5 / max_attempts) as u8, // Progress from 95 to 100
                "Verifying Game API plugin...",
                &format!(
                    "Checking Game API availability (attempt {}/{})",
                    attempt + 1,
                    max_attempts
                ),
            )
            .await;

            // First check basic health
            let health_url = format!("http://localhost:{}/api/server/health", agent_port);
            let health_response = client
                .get(&health_url)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;

            if let Ok(response) = health_response {
                if response.status().is_success() {
                    // Add a small delay to avoid rapid successive requests
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

                    // Use the actual agent ID
                    let agent_id = "2fbc0c27-50f4-09f2-9fe4-9dd27d76d46f";
                    let settings_url = format!(
                        "http://localhost:{}/api/agents/{}/settings",
                        agent_port, agent_id
                    );
                    let settings_response = client
                        .get(&settings_url)
                        .timeout(std::time::Duration::from_secs(5))
                        .send()
                        .await;

                    if let Ok(settings_resp) = settings_response {
                        let status = settings_resp.status();

                        // Handle rate limiting specifically
                        if status.as_u16() == 429 {
                            warn!("⚠️ Rate limit hit, using longer backoff...");
                            // Force a longer delay on next iteration
                            continue;
                        }

                        // Accept success (200) or service unavailable (503) which means route exists but runtime not ready
                        if status.is_success() || status.as_u16() == 503 {
                            if status.is_success() {
                                info!("✅ Game API plugin routes are ready and responding");
                            } else {
                                info!("✅ Game API plugin routes exist (runtime initializing)");
                            }

                            self.update_status(
                                StartupStage::GameAPIReady,
                                100,
                                "Game API verified!",
                                "All systems operational - ready to play",
                            )
                            .await;

                            return Ok(true);
                        } else if status.as_u16() == 404 {
                            // Try to get the primary agent and use its endpoint
                            info!(
                                "⚠️ Default endpoint not found, trying primary agent discovery..."
                            );

                            // Add delay to avoid rapid requests
                            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

                            let primary_url =
                                format!("http://localhost:{}/api/agents/primary", agent_port);
                            if let Ok(primary_resp) = client
                                .get(&primary_url)
                                .timeout(std::time::Duration::from_secs(2))
                                .send()
                                .await
                            {
                                if primary_resp.status().is_success() {
                                    if let Ok(primary_data) =
                                        primary_resp.json::<serde_json::Value>().await
                                    {
                                        if let Some(true) =
                                            primary_data["data"]["available"].as_bool()
                                        {
                                            info!("✅ Primary agent discovered, Game API is ready");

                                            self.update_status(
                                                StartupStage::GameAPIReady,
                                                100,
                                                "Game API verified!",
                                                "All systems operational - ready to play",
                                            )
                                            .await;

                                            return Ok(true);
                                        }
                                    }
                                }
                            }

                            warn!("⚠️ Game API plugin routes not found (404) and primary agent not available");
                        } else {
                            warn!(
                                "⚠️ Game API plugin routes not ready yet (status: {})",
                                status
                            );

                            // Try to get error details
                            if let Ok(error_text) = settings_resp.text().await {
                                warn!("⚠️ Error response: {}", error_text);
                            }
                        }
                    } else if let Err(e) = settings_response {
                        warn!("⚠️ Failed to connect to settings endpoint: {}", e);
                    }
                }
            } else if let Err(e) = health_response {
                warn!("⚠️ Health check failed: {}", e);
            }
        }

        warn!(
            "❌ Game API verification failed after {} attempts",
            max_attempts
        );
        Ok(false)
    }

    async fn setup_containers(&mut self) -> BackendResult<()> {
        let container_manager = self.container_manager.as_ref().ok_or_else(|| {
            BackendError::Container("Container manager not initialized".to_string())
        })?;

        let _config = self
            .config
            .as_ref()
            .ok_or_else(|| BackendError::Container("User config not available".to_string()))?;

        // On macOS, prefer native Ollama when available. Detect and set before starting containers.
        #[cfg(target_os = "macos")]
        {
            self.update_status(
                StartupStage::StartingOllama,
                38,
                "Checking native Ollama...",
                "Detecting local Ollama service on macOS",
            )
            .await;

            let client = reqwest::Client::new();
            let mut native_ok = false;
            if let Ok(resp) = client
                .get("http://localhost:11434/api/version")
                .timeout(std::time::Duration::from_secs(2))
                .send()
                .await
            {
                if resp.status().is_success() {
                    native_ok = true;
                }
            }

            if !native_ok {
                // Attempt to start via Homebrew
                let brew_paths = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
                let mut brew_found = None;
                for p in brew_paths {
                    if std::path::Path::new(p).exists() {
                        brew_found = Some(p);
                        break;
                    }
                }
                if let Some(brew) = brew_found {
                    let _ = std::process::Command::new(brew)
                        .args(["services", "start", "ollama"]).output();
                    for _ in 0..10u8 {
                        if let Ok(resp) = client
                            .get("http://localhost:11434/api/version")
                            .timeout(std::time::Duration::from_secs(2))
                            .send()
                            .await
                        {
                            if resp.status().is_success() { native_ok = true; break; }
                        }
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    }
                }
            }

            if native_ok {
                container_manager.set_use_native_ollama(true).await;
                let current = container_manager.get_port_config().await;
                container_manager.update_port_config(crate::container::manager::PortConfig {
                    postgres_port: current.postgres_port,
                    ollama_port: 11434,
                    agent_port: current.agent_port,
                }).await;
                info!("✅ Using native Ollama on macOS (pre-container setup)");
            } else {
                container_manager.set_use_native_ollama(false).await;
            }
        }

        self.update_status(
            StartupStage::InitializingContainers,
            45,
            "Setting up containers...",
            "Preparing container environment",
        )
        .await;

        // Use the new robust container startup method with retry logic
        info!("🚀 Starting containers with dependency management and retry logic...");

        // Start containers with proper error handling and retries
        match container_manager.start_containers_with_dependencies().await {
            Ok(()) => {
                info!("✅ All containers started successfully");

                // Update status to indicate containers are ready
                self.update_status(
                    StartupStage::ContainersReady,
                    90,
                    "All containers are healthy",
                    "PostgreSQL, Ollama, and Agent are running",
                )
                .await;

                // Start message server after all containers are ready
                self.update_status(
                    StartupStage::StartingMessageServer,
                    95,
                    "Initializing message server...",
                    "Starting WebSocket connection to agent",
                )
                .await;

                // Give a moment for all services to stabilize
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

                // Verify Game API plugin is ready before declaring success
                match self.verify_game_api().await {
                    Ok(true) => {
                        self.update_status(
                            StartupStage::Ready,
                            100,
                            "ELIZA Game is ready!",
                            "All systems operational",
                        )
                        .await;

                        Ok(())
                    }
                    Ok(false) => {
                        error!("❌ Game API verification failed");

                        self.update_status(
                            StartupStage::Error,
                            0,
                            "Game API verification failed",
                            "The Game API plugin is not responding. Chat functionality will be disabled.",
                        )
                        .await;

                        Err(BackendError::Container(
                            "Game API plugin verification failed".to_string(),
                        ))
                    }
                    Err(e) => {
                        error!("❌ Error during Game API verification: {}", e);

                        self.update_status(
                            StartupStage::Error,
                            0,
                            "Game API verification error",
                            &format!("Failed to verify Game API: {}", e),
                        )
                        .await;

                        Err(e)
                    }
                }
            }
            Err(e) => {
                error!("❌ Failed to start containers: {}", e);

                self.update_status(
                    StartupStage::Error,
                    0,
                    "Container startup failed",
                    &format!("Error: {}\n\nPlease check Podman status and try again.", e),
                )
                .await;

                Err(e)
            }
        }
    }

    async fn update_status(&self, stage: StartupStage, progress: u8, message: &str, details: &str) {
        let mut status = self.status.lock().unwrap();
        status.stage = stage.clone();
        status.progress = progress;
        status.message = message.to_string();
        status.details = details.to_string();

        // Update game_api_ready based on stage
        status.game_api_ready = matches!(stage, StartupStage::GameAPIReady | StartupStage::Ready);

        let status_clone = status.clone();
        drop(status);

        // Emit to frontend
        if let Err(e) = self.app_handle.emit("startup-status", &status_clone) {
            error!("Failed to emit startup status: {}", e);
        }
    }

    pub fn get_status(&self) -> StartupStatus {
        self.status.lock().unwrap().clone()
    }

    pub fn is_ready(&self) -> bool {
        matches!(self.status.lock().unwrap().stage, StartupStage::Ready)
    }

    pub fn get_container_manager(&self) -> Option<Arc<ContainerManager>> {
        self.container_manager.clone()
    }

    /// Clean up any orphaned containers from previous runs
    async fn cleanup_orphaned_containers(
        &mut self,
        resource_dir: &std::path::Path,
    ) -> BackendResult<()> {
        info!("🧹 Checking for orphaned containers from previous runs...");

        // First ensure we have a container manager
        if self.container_manager.is_none() {
            // Try to create a minimal container manager just for cleanup
            match ContainerManager::new_with_runtime_manager(
                ContainerRuntimeType::Podman,
                resource_dir.to_path_buf(),
            )
            .await
            {
                Ok(mut manager) => {
                    manager.set_app_handle(self.app_handle.clone());
                    self.container_manager = Some(Arc::new(manager));
                }
                Err(e) => {
                    warn!("Could not create container manager for cleanup: {}", e);
                    return Ok(()); // Not critical, continue
                }
            }
        }

        if let Some(manager) = &self.container_manager {
            // Clean up any eliza-* containers that might be left over
            match manager.cleanup_containers_by_pattern("eliza-").await {
                Ok(()) => info!("✅ Orphaned container cleanup completed"),
                Err(e) => warn!("⚠️ Failed to cleanup some containers: {}", e),
            }
        }

        Ok(())
    }

    async fn ensure_podman_ready(&self) -> BackendResult<()> {
        use crate::container::retry::{retry_with_backoff, RetryConfig};

        info!("🔍 Ensuring Podman is ready...");

        // First, check if Podman is already healthy with retries
        let quick_check_result =
            retry_with_backoff("Podman health check", RetryConfig::quick(), || async {
                let output = tokio::process::Command::new("podman")
                    .args(["info", "--format", "{{.Host.Arch}}"])
                    .output()
                    .await
                    .map_err(|e| {
                        BackendError::Container(format!("Failed to run podman info: {}", e))
                    })?;

                if output.status.success() {
                    Ok(())
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    Err(BackendError::Container(format!(
                        "Podman not healthy: {}",
                        stderr
                    )))
                }
            })
            .await;

        if quick_check_result.is_ok() {
            info!("✅ Podman is already running and healthy");
            return Ok(());
        }

        // Podman not healthy, try to recover
        info!("⚠️ Podman not responding, attempting recovery...");

        // Check connection status
        let connection_check = tokio::process::Command::new("podman")
            .args([
                "system",
                "connection",
                "list",
                "--format",
                "{{.Name}},{{.Default}}",
            ])
            .output()
            .await
            .map_err(|e| BackendError::Container(format!("Failed to check connections: {}", e)))?;

        if !connection_check.status.success() {
            // No connections available, try to initialize
            info!("📝 No Podman connections found, initializing machine...");

            let init_result = tokio::process::Command::new("podman")
                .args(["machine", "init"])
                .output()
                .await
                .map_err(|e| {
                    BackendError::Container(format!("Failed to init Podman machine: {}", e))
                })?;

            let stderr = String::from_utf8_lossy(&init_result.stderr);
            if !init_result.status.success() && !stderr.contains("already exists") {
                return Err(BackendError::Container(format!(
                    "Failed to initialize Podman machine: {}",
                    stderr
                )));
            }
        }

        // Check machine status
        let machine_check = tokio::process::Command::new("podman")
            .args(["machine", "list", "--format", "{{.Name}},{{.Running}}"])
            .output()
            .await;

        let needs_start = match machine_check {
            Ok(output) => {
                let output_str = String::from_utf8_lossy(&output.stdout);
                !output_str.lines().any(|line| line.contains("true"))
            }
            Err(_) => true, // Assume we need to start if we can't check
        };

        // Check and configure memory before starting the machine
        info!("🧠 Checking system memory and Podman machine configuration...");
        let memory_config = MemoryConfig::calculate();

        if !memory_config.has_sufficient_memory {
            return Err(BackendError::Container(format!(
                "Insufficient system memory. System has {:.1} GB, but at least 7.5 GB is recommended for running llama3.2:3b model",
                memory_config.total_system_memory_mb as f64 / 1024.0
            )));
        }

        // Check if memory adjustment is needed
        if memory_config.needs_memory_adjustment().await? {
            info!("📊 Adjusting Podman machine memory allocation...");
            self.update_status(
                StartupStage::DetectingRuntime,
                15,
                "Configuring memory allocation...",
                &format!(
                    "Setting Podman machine memory to {:.1} GB based on system memory",
                    memory_config.podman_machine_memory_mb as f64 / 1024.0
                ),
            )
            .await;

            // Apply the memory configuration
            memory_config.apply_to_podman_machine().await?;
        }

        if needs_start {
            info!("🚀 Starting Podman machine...");

            // Try to stop first in case it's in a bad state
            let _ = tokio::process::Command::new("podman")
                .args(["machine", "stop"])
                .output()
                .await;

            // Wait a bit for clean shutdown
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

            // Now start the machine with retries
            retry_with_backoff(
                "Podman machine start",
                RetryConfig::podman_recovery(),
                || async {
                    let output = tokio::process::Command::new("podman")
                        .args(["machine", "start"])
                        .output()
                        .await
                        .map_err(|e| {
                            BackendError::Container(format!(
                                "Failed to run podman machine start: {}",
                                e
                            ))
                        })?;

                    let stderr = String::from_utf8_lossy(&output.stderr);

                    // Check if it's already running (not an error)
                    if !output.status.success() && !stderr.contains("already running") {
                        Err(BackendError::Container(format!(
                            "Failed to start Podman machine: {}",
                            stderr
                        )))
                    } else {
                        Ok(())
                    }
                },
            )
            .await?;

            info!("✅ Podman machine started successfully");

            // Wait for it to be fully ready
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        }

        // Reset the default connection if needed
        info!("🔗 Resetting Podman connection...");
        let reset_result = tokio::process::Command::new("podman")
            .args(["system", "connection", "default", "podman-machine-default"])
            .output()
            .await;

        if let Ok(output) = reset_result {
            if !output.status.success() {
                warn!(
                    "Failed to reset default connection: {}",
                    String::from_utf8_lossy(&output.stderr)
                );
            }
        }

        // Final health check with retries
        retry_with_backoff(
            "Final Podman health check",
            RetryConfig::podman_recovery(),
            || async {
                let output = tokio::process::Command::new("podman")
                    .args(["info", "--format", "{{.Host.Arch}}"])
                    .output()
                    .await
                    .map_err(|e| {
                        BackendError::Container(format!("Final health check failed: {}", e))
                    })?;

                if !output.status.success() {
                    let error_str = String::from_utf8_lossy(&output.stderr);
                    Err(BackendError::Container(format!(
                        "Podman is not responding after recovery: {}",
                        error_str
                    )))
                } else {
                    Ok(())
                }
            },
        )
        .await?;

        info!("✅ Podman connection verified and ready");
        Ok(())
    }

    async fn ensure_agentserver_image(&self) -> BackendResult<()> {
        info!("🔍 Checking for eliza-agent:latest image...");

        let output = tokio::process::Command::new("podman")
            .args(["image", "exists", "eliza-agent:latest"])
            .output()
            .await
            .map_err(|e| BackendError::Container(format!("Failed to check image: {}", e)))?;

        if output.status.success() {
            info!("✅ eliza-agent:latest image found");
            return Ok(());
        }

        warn!("⚠️ eliza-agent:latest image not found, building...");

        // Change to agentserver directory and build
        let current_dir = std::env::current_dir().map_err(|e| {
            BackendError::Container(format!("Failed to get current directory: {}", e))
        })?;

        let agentserver_dir = current_dir.join("packages").join("agentserver");

        if !agentserver_dir.exists() {
            return Err(BackendError::Container(
                "packages/agentserver directory not found. Please ensure you're running from the project root.".to_string()
            ));
        }

        info!("📦 Building Linux binary for containerization...");
        let binary_output = tokio::process::Command::new("bun")
            .args(["run", "build:binary", "linux"])
            .current_dir(&agentserver_dir)
            .output()
            .await
            .map_err(|e| BackendError::Container(format!("Failed to build binary: {}", e)))?;

        if !binary_output.status.success() {
            let error_str = String::from_utf8_lossy(&binary_output.stderr);
            return Err(BackendError::Container(format!(
                "Binary build failed: {}",
                error_str
            )));
        }

        info!("🐳 Building Docker image...");

        // First, ensure Podman machine is running before attempting build
        let machine_check = tokio::process::Command::new("podman")
            .args(["system", "connection", "list"])
            .output()
            .await;

        if machine_check.is_err() || !machine_check.unwrap().status.success() {
            warn!("⚠️ Cannot connect to Podman, attempting to start machine...");

            // Try to list machines
            let machine_list = tokio::process::Command::new("podman")
                .args(["machine", "list", "--format", "json"])
                .output()
                .await;

            if let Ok(list_output) = machine_list {
                if list_output.status.success() {
                    // Try to start the default machine
                    let start_result = tokio::process::Command::new("podman")
                        .args(["machine", "start"])
                        .output()
                        .await;

                    if let Ok(start_output) = start_result {
                        if start_output.status.success() {
                            info!("✅ Podman machine started successfully");
                            // Wait for machine to be ready
                            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                        } else {
                            warn!("Failed to start Podman machine, attempting to continue anyway");
                        }
                    }
                }
            }
        }

        let docker_output = tokio::process::Command::new("podman")
            .args([
                "build",
                "-f",
                "Dockerfile.standalone",
                "-t",
                "eliza-agent:latest",
                ".",
            ])
            .current_dir(&agentserver_dir)
            .output()
            .await
            .map_err(|e| BackendError::Container(format!("Failed to build image: {}", e)))?;

        if !docker_output.status.success() {
            let error_str = String::from_utf8_lossy(&docker_output.stderr);
            return Err(BackendError::Container(format!(
                "Image build failed: {}",
                error_str
            )));
        }

        info!("✅ eliza-agent:latest image built successfully");
        Ok(())
    }
}
