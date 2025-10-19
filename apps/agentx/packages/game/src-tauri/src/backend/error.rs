use thiserror::Error;

#[derive(Error, Debug)]
pub enum BackendError {
    #[error("Container error: {0}")]
    Container(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Authentication error: {0}")]
    Auth(String),

    #[error("Agent process error: {0}")]
    AgentProcess(String),

    #[error("HTTP server error: {0}")]
    HttpServer(String),

    #[error("WebSocket error: {0}")]
    WebSocket(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Network error: {0}")]
    Network(String),

    #[error("Resource error: {0}")]
    Resource(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("SQL error: {0}")]
    Sql(#[from] sqlx::Error),

    #[error("HTTP client error: {0}")]
    HttpClient(#[from] reqwest::Error),
}

pub type BackendResult<T> = Result<T, BackendError>;
