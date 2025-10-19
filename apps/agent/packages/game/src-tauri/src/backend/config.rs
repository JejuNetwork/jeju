use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendConfig {
    pub http_port: u16,
    pub websocket_port: u16,
    pub postgres_url: String,
    pub auth: AuthConfig,
    pub container: ContainerRuntimeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    pub jwt_secret: String,
    pub session_timeout_hours: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerRuntimeConfig {
    pub runtime_type: ContainerRuntimeType,
    pub podman_path: Option<String>,
    pub docker_socket: Option<String>,
    pub bundled_images_path: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum ContainerRuntimeType {
    Podman,
    Docker,
}

impl Default for BackendConfig {
    fn default() -> Self {
        Self {
            http_port: 7777, // Frontend expects port 7777
            websocket_port: 7779,
            postgres_url: "postgresql://eliza:eliza@localhost:5432/eliza".to_string(),
            auth: AuthConfig {
                jwt_secret: "dev-secret-change-in-production".to_string(),
                session_timeout_hours: 24,
            },
            container: ContainerRuntimeConfig {
                runtime_type: ContainerRuntimeType::Podman,
                podman_path: None,
                docker_socket: None,
                bundled_images_path: None,
            },
        }
    }
}
