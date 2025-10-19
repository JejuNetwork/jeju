use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub id: Uuid,
    pub name: String,
    pub character_file: Option<String>,
    pub plugins: Vec<String>,
    pub settings: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerConfig {
    pub name: String,
    pub image: String,
    pub ports: Vec<PortMapping>,
    pub environment: Vec<String>,
    pub volumes: Vec<VolumeMount>,
    pub health_check: Option<HealthCheckConfig>,
    pub network: Option<String>,
    pub memory_limit: Option<String>, // e.g., "8g", "8192m", "8589934592"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortMapping {
    pub host_port: u16,
    pub container_port: u16,
    pub protocol: String,
}

impl PortMapping {
    #[must_use]
    pub fn new(host_port: u16, container_port: u16) -> Self {
        Self {
            host_port,
            container_port,
            protocol: "tcp".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeMount {
    pub host_path: String,
    pub container_path: String,
    pub read_only: bool,
}

impl VolumeMount {
    #[must_use]
    pub fn new(host_path: &str, container_path: &str) -> Self {
        Self {
            host_path: host_path.to_string(),
            container_path: container_path.to_string(),
            read_only: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckConfig {
    pub command: Vec<String>,
    pub interval_seconds: u64,
    pub timeout_seconds: u64,
    pub retries: u32,
    pub start_period_seconds: u64,
}

impl HealthCheckConfig {
    pub fn postgres_default() -> Self {
        Self {
            command: vec![
                "pg_isready".to_string(),
                "-U".to_string(),
                "eliza".to_string(),
                "-d".to_string(),
                "eliza".to_string(),
            ],
            interval_seconds: 10,
            timeout_seconds: 5,
            retries: 3,
            start_period_seconds: 30,
        }
    }

    pub fn ollama_default() -> Self {
        Self {
            command: vec![
                "sh".to_string(),
                "-c".to_string(),
                // Use wget instead of curl as it's more likely to be available
                // Also try multiple methods to check Ollama health
                "wget -q -O - http://localhost:11434/api/version || \
                 curl -f -s http://localhost:11434/api/version || \
                 (echo 'GET /api/version HTTP/1.0\r\n\r\n' | nc localhost 11434 | grep -q 'HTTP/1.1 200') || \
                 exit 1".to_string(),
            ],
            interval_seconds: 20,  // Increased to give more time between checks
            timeout_seconds: 15,   // Increased timeout
            retries: 10,          // More retries as Ollama can be slow to start
            start_period_seconds: 90,  // Give Ollama plenty of time to initialize
        }
    }

    pub fn agent_default() -> Self {
        Self {
            command: vec![
                "curl".to_string(),
                "-f".to_string(),
                "http://localhost:7777/api/server/health".to_string(),
            ],
            interval_seconds: 15,
            timeout_seconds: 10,
            retries: 3,
            start_period_seconds: 60,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerStatus {
    pub id: String,
    pub name: String,
    pub state: ContainerState,
    pub health: HealthStatus,
    pub ports: Vec<PortMapping>,
    pub started_at: Option<i64>,
    pub uptime_seconds: u64,
    pub restart_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ContainerState {
    Running,
    Stopped,
    Starting,
    Error,
    Unknown,
}

impl std::fmt::Display for ContainerState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ContainerState::Running => write!(f, "Running"),
            ContainerState::Stopped => write!(f, "Stopped"),
            ContainerState::Starting => write!(f, "Starting"),
            ContainerState::Error => write!(f, "Error"),
            ContainerState::Unknown => write!(f, "Unknown"),
        }
    }
}

impl From<&str> for ContainerState {
    fn from(state: &str) -> Self {
        match state.to_lowercase().as_str() {
            "running" => ContainerState::Running,
            "stopped" | "exited" => ContainerState::Stopped,
            "starting" | "created" => ContainerState::Starting,
            "error" | "dead" => ContainerState::Error,
            _ => ContainerState::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HealthStatus {
    Healthy,
    Unhealthy,
    Starting,
    Unknown,
}

impl From<&str> for HealthStatus {
    fn from(health: &str) -> Self {
        match health.to_lowercase().as_str() {
            "healthy" => HealthStatus::Healthy,
            "unhealthy" => HealthStatus::Unhealthy,
            "starting" => HealthStatus::Starting,
            _ => HealthStatus::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProcess {
    pub id: Uuid,
    pub name: String,
    pub state: AgentState,
    pub config: AgentConfig,
    pub started_at: Option<i64>,
    pub last_activity: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentState {
    Starting,
    Running,
    Stopped,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentMessage {
    UserMessage {
        id: Uuid,
        text: String,
        room_id: Uuid,
    },
    AgentResponse {
        id: Uuid,
        text: String,
        room_id: Uuid,
    },
    AgentReady {
        agent_id: Uuid,
        room_id: Uuid,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token: String,
    pub expires_at: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResult {
    pub token: String,
    pub user: UserInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: Uuid,
    pub username: String,
    pub roles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupProgress {
    pub stage: String,
    pub progress: u8,
    pub message: String,
    pub details: String,
    pub can_retry: bool,
    pub model_progress: Option<ModelDownloadProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDownloadProgress {
    pub model_name: String,
    pub current_mb: f64,
    pub total_mb: f64,
    pub percentage: u8,
    pub speed_mbps: f64,
    pub eta_seconds: u32,
    pub status: ModelDownloadStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModelDownloadStatus {
    Downloading,
    Completed,
    Failed,
    AlreadyExists,
}
