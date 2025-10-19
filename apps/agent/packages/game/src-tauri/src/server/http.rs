use crate::backend::{BackendConfig, BackendError, BackendResult};
use crate::container::ContainerManager;
use crate::server::websocket::{app_websocket_handler, WebSocketHub};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde_json::Value;
use std::sync::Arc;
use tower::ServiceBuilder;
use tower_http::cors::CorsLayer;
use tracing::{error, info};

pub struct HttpServer {
    config: BackendConfig,
    container_manager: Arc<ContainerManager>,
    websocket_hub: Arc<WebSocketHub>,
}

impl HttpServer {
    /// Creates a new HTTP server instance.
    ///
    /// # Panics
    ///
    /// Panics if the container manager fails to initialize.
    #[must_use]
    pub fn new() -> Self {
        Self {
            config: BackendConfig::default(),
            container_manager: Arc::new(
                ContainerManager::new_with_runtime_type(
                    crate::backend::ContainerRuntimeType::Podman,
                )
                .expect("Failed to create container manager"),
            ),
            websocket_hub: Arc::new(WebSocketHub::new()),
        }
    }

    pub fn create_router(&self) -> Router {
        Router::new()
            // Health endpoints
            .route("/api/server/health", get(health_check))
            .route("/api/agent/id", get(agent_id))
            .route("/autonomy/status", get(autonomy_status))
            // Container management
            .route("/api/containers/status", get(container_status))
            .route("/api/containers/:name/restart", post(restart_container))
            // Note: Agent management handled via Tauri IPC, not HTTP routes
            // WebSocket upgrade
            .route("/ws", get(ws_handler))
            .route("/api/websocket/info", get(websocket_info))
            // Add state
            .with_state(AppState {
                container_manager: self.container_manager.clone(),
                websocket_hub: self.websocket_hub.clone(),
            })
            // Middleware
            .layer(ServiceBuilder::new().layer(CorsLayer::permissive()))
    }

    /// Starts the HTTP server and begins listening for requests.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Failed to bind to the specified address
    /// - Server encounters a runtime error while serving requests
    pub async fn start(&self) -> BackendResult<()> {
        let app = self.create_router();
        let addr = format!("127.0.0.1:{}", self.config.http_port);

        info!("Starting HTTP server on {}", addr);

        let listener = tokio::net::TcpListener::bind(&addr)
            .await
            .map_err(|e| BackendError::HttpServer(format!("Failed to bind to {addr}: {e}")))?;

        info!("HTTP server bound to {}, starting to serve requests", addr);

        axum::serve(listener, app)
            .await
            .map_err(|e| BackendError::HttpServer(format!("Server error: {e}")))?;

        Ok(())
    }
}

impl Default for HttpServer {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone)]
struct AppState {
    container_manager: Arc<ContainerManager>,
    websocket_hub: Arc<WebSocketHub>,
}

// Handler functions

async fn health_check() -> Json<Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "backend": "rust",
        "timestamp": chrono::Utc::now().timestamp()
    }))
}

async fn agent_id() -> Json<Value> {
    Json(serde_json::json!({
        "agent_id": uuid::Uuid::new_v4()
    }))
}

async fn autonomy_status() -> Json<Value> {
    Json(serde_json::json!({
        "status": "running",
        "autonomous": true,
        "goals": [],
        "current_task": null,
        "uptime": 0
    }))
}

async fn container_status(State(state): State<AppState>) -> Result<Json<Value>, StatusCode> {
    match state.container_manager.get_all_statuses().await {
        Ok(statuses) => Ok(Json(serde_json::json!({ "containers": statuses }))),
        Err(e) => {
            error!("Failed to get container status: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn restart_container(
    axum::extract::Path(name): axum::extract::Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, StatusCode> {
    match state.container_manager.restart_container(&name).await {
        Ok(status) => Ok(Json(serde_json::json!({
            "message": format!("Container {} restarted successfully", name),
            "status": status
        }))),
        Err(e) => {
            error!("Failed to restart container {}: {}", name, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// All agent management handlers removed - functionality handled via Tauri IPC

async fn websocket_info(State(state): State<AppState>) -> Json<Value> {
    Json(serde_json::json!({
        "websocket_endpoint": "/ws",
        "connected_clients": state.websocket_hub.get_client_count(),
        "active_rooms": state.websocket_hub.get_room_count(),
        "status": "active"
    }))
}

// Local wrapper for WebSocket handler that extracts hub from state
async fn ws_handler(
    ws: axum::extract::WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    app_websocket_handler(ws, state.websocket_hub).await
}
