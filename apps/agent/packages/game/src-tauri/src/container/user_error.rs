use crate::backend::BackendError;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tracing::{error, info};

/// User-friendly error representation with actionable guidance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserError {
    pub code: ErrorCode,
    pub title: String,
    pub message: String,
    pub technical_details: Option<String>,
    pub suggestions: Vec<String>,
    pub actions: Vec<ErrorAction>,
    pub can_retry: bool,
    pub estimated_fix_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    // Container errors
    PortConflict,
    ContainerNotFound,
    ContainerTimeout,
    PodmanNotRunning,
    PodmanMachineError,

    // Resource errors
    InsufficientMemory,
    InsufficientDisk,
    CpuOverload,

    // Network errors
    NetworkTimeout,
    DownloadFailed,
    NoInternetConnection,

    // Model errors
    ModelTooLarge,
    ModelDownloadFailed,
    ModelCorrupted,

    // System errors
    PermissionDenied,
    FileSystemError,
    OperationInProgress,
    UnknownError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ErrorAction {
    Retry {
        label: String,
        command: String,
    },
    OpenUrl {
        label: String,
        url: String,
    },
    RunCommand {
        label: String,
        command: String,
        description: String,
    },
    ChangeSettings {
        label: String,
        setting: String,
        recommended_value: String,
    },
    ContactSupport {
        label: String,
        issue_template: String,
    },
    ShowLogs {
        label: String,
        log_filter: Option<String>,
    },
}

impl From<BackendError> for UserError {
    fn from(err: BackendError) -> Self {
        let technical_details = Some(format!("{:?}", err));

        match err {
            BackendError::Container(msg) => UserError::from_container_error(msg, technical_details),
            BackendError::Network(msg) => UserError::from_network_error(msg, technical_details),
            BackendError::Resource(msg) => UserError::from_resource_error(msg, technical_details),
            _ => UserError::generic_error(err.to_string(), technical_details),
        }
    }
}

impl UserError {
    fn from_container_error(msg: String, technical_details: Option<String>) -> Self {
        let lower_msg = msg.to_lowercase();

        // Port conflict detection
        if lower_msg.contains("port")
            && (lower_msg.contains("in use") || lower_msg.contains("already"))
        {
            return Self::port_conflict_error(msg, technical_details);
        }

        // Podman machine errors
        if lower_msg.contains("podman machine") || lower_msg.contains("cannot connect to podman") {
            return Self::podman_machine_error(msg, technical_details);
        }

        // Container not found
        if lower_msg.contains("not found") || lower_msg.contains("no such container") {
            return Self::container_not_found_error(msg, technical_details);
        }

        // Generic container error
        Self {
            code: ErrorCode::ContainerNotFound,
            title: "Container Error".to_string(),
            message: "There was a problem with the container system.".to_string(),
            technical_details,
            suggestions: vec![
                "Make sure Podman or Docker is installed and running".to_string(),
                "Try restarting the application".to_string(),
                "Check if you have sufficient permissions".to_string(),
            ],
            actions: vec![
                ErrorAction::ShowLogs {
                    label: "View Container Logs".to_string(),
                    log_filter: Some("container".to_string()),
                },
                ErrorAction::Retry {
                    label: "Try Again".to_string(),
                    command: "retry_operation".to_string(),
                },
            ],
            can_retry: true,
            estimated_fix_time: Some("1-2 minutes".to_string()),
        }
    }

    fn port_conflict_error(msg: String, technical_details: Option<String>) -> Self {
        // Extract port number if possible
        let port = extract_port_from_message(&msg).unwrap_or(5432);

        let (service_name, suggestions) = match port {
            5432 => (
                "PostgreSQL",
                vec![
                    "Another PostgreSQL instance might be running".to_string(),
                    "Docker Desktop might be using this port".to_string(),
                    "Try stopping other database services".to_string(),
                ],
            ),
            11434 => (
                "Ollama",
                vec![
                    "Another Ollama instance might be running".to_string(),
                    "Check if Ollama Desktop is running".to_string(),
                    "Try 'ollama stop' in terminal".to_string(),
                ],
            ),
            7777 => (
                "Agent Server",
                vec![
                    "Another instance of ElizaOS might be running".to_string(),
                    "A development server might be using this port".to_string(),
                    "Check your other terminal windows".to_string(),
                ],
            ),
            _ => (
                "Service",
                vec![
                    format!("Port {} is being used by another application", port),
                    "Try closing other development tools".to_string(),
                    "Restart your computer to free up ports".to_string(),
                ],
            ),
        };

        Self {
            code: ErrorCode::PortConflict,
            title: format!("{} Port Already In Use", service_name),
            message: format!(
                "Port {} is already being used by another application. \
                This prevents {} from starting.",
                port, service_name
            ),
            technical_details,
            suggestions,
            actions: vec![
                ErrorAction::RunCommand {
                    label: "Find What's Using the Port".to_string(),
                    command: if cfg!(windows) {
                        format!("netstat -ano | findstr :{}", port)
                    } else {
                        format!("lsof -i :{}", port)
                    },
                    description: "Shows which process is using the port".to_string(),
                },
                ErrorAction::ChangeSettings {
                    label: "Use Different Port".to_string(),
                    setting: format!("{}_port", service_name.to_lowercase()),
                    recommended_value: get_alternative_port(port).to_string(),
                },
                ErrorAction::Retry {
                    label: "Try Again".to_string(),
                    command: "retry_with_port_cleanup".to_string(),
                },
            ],
            can_retry: true,
            estimated_fix_time: Some("30 seconds".to_string()),
        }
    }

    fn podman_machine_error(_msg: String, technical_details: Option<String>) -> Self {
        Self {
            code: ErrorCode::PodmanMachineError,
            title: "Podman Machine Not Running".to_string(),
            message: "The Podman virtual machine needs to be started to manage containers."
                .to_string(),
            technical_details,
            suggestions: vec![
                "Podman requires a virtual machine on macOS and Windows".to_string(),
                "The machine might have stopped due to inactivity".to_string(),
                "This is normal and can be fixed quickly".to_string(),
            ],
            actions: vec![
                ErrorAction::RunCommand {
                    label: "Start Podman Machine".to_string(),
                    command: "podman machine start".to_string(),
                    description: "Starts the Podman virtual machine".to_string(),
                },
                ErrorAction::RunCommand {
                    label: "Check Machine Status".to_string(),
                    command: "podman machine list".to_string(),
                    description: "Shows all Podman machines and their status".to_string(),
                },
                ErrorAction::OpenUrl {
                    label: "Podman Setup Guide".to_string(),
                    url: "https://podman.io/docs/installation".to_string(),
                },
            ],
            can_retry: true,
            estimated_fix_time: Some("1-2 minutes".to_string()),
        }
    }

    fn from_network_error(msg: String, technical_details: Option<String>) -> Self {
        let lower_msg = msg.to_lowercase();

        if lower_msg.contains("timeout") {
            Self::network_timeout_error(msg, technical_details)
        } else if lower_msg.contains("no internet") || lower_msg.contains("connection") {
            Self::no_internet_error(msg, technical_details)
        } else {
            Self::generic_network_error(msg, technical_details)
        }
    }

    fn network_timeout_error(_msg: String, technical_details: Option<String>) -> Self {
        Self {
            code: ErrorCode::NetworkTimeout,
            title: "Network Connection Slow".to_string(),
            message: "The download is taking longer than expected. This might be due to a slow internet connection.".to_string(),
            technical_details,
            suggestions: vec![
                "Check your internet connection speed".to_string(),
                "Try using a wired connection if on WiFi".to_string(),
                "Downloads will resume automatically if interrupted".to_string(),
            ],
            actions: vec![
                ErrorAction::Retry {
                    label: "Retry Download".to_string(),
                    command: "retry_download".to_string(),
                },
                ErrorAction::ChangeSettings {
                    label: "Use Smaller Model".to_string(),
                    setting: "model_size".to_string(),
                    recommended_value: "small".to_string(),
                },
                ErrorAction::ShowLogs {
                    label: "View Download Progress".to_string(),
                    log_filter: Some("download".to_string()),
                },
            ],
            can_retry: true,
            estimated_fix_time: Some("Depends on connection speed".to_string()),
        }
    }

    fn from_resource_error(msg: String, technical_details: Option<String>) -> Self {
        let lower_msg = msg.to_lowercase();

        if lower_msg.contains("memory") {
            Self::insufficient_memory_error(msg, technical_details)
        } else if lower_msg.contains("disk") || lower_msg.contains("space") {
            Self::insufficient_disk_error(msg, technical_details)
        } else {
            Self::generic_resource_error(msg, technical_details)
        }
    }

    fn insufficient_memory_error(_msg: String, technical_details: Option<String>) -> Self {
        Self {
            code: ErrorCode::InsufficientMemory,
            title: "Not Enough Memory".to_string(),
            message:
                "Your system doesn't have enough RAM to run all the AI models. Let's fix this."
                    .to_string(),
            technical_details,
            suggestions: vec![
                "Close other applications to free up memory".to_string(),
                "Use smaller AI models that require less memory".to_string(),
                "Consider upgrading your system's RAM".to_string(),
            ],
            actions: vec![
                ErrorAction::RunCommand {
                    label: "Check Memory Usage".to_string(),
                    command: if cfg!(windows) {
                        "taskmgr"
                    } else if cfg!(target_os = "macos") {
                        "open -a 'Activity Monitor'"
                    } else {
                        "free -h"
                    }
                    .to_string(),
                    description: "Opens system resource monitor".to_string(),
                },
                ErrorAction::ChangeSettings {
                    label: "Use Smaller Models".to_string(),
                    setting: "use_small_models".to_string(),
                    recommended_value: "true".to_string(),
                },
                ErrorAction::OpenUrl {
                    label: "Memory Optimization Guide".to_string(),
                    url: "https://docs.eliza.ai/optimization".to_string(),
                },
            ],
            can_retry: false,
            estimated_fix_time: Some("5-10 minutes".to_string()),
        }
    }

    fn container_not_found_error(_msg: String, technical_details: Option<String>) -> Self {
        Self {
            code: ErrorCode::ContainerNotFound,
            title: "Container Not Found".to_string(),
            message: "A required container is missing. This usually happens after a crash or manual intervention.".to_string(),
            technical_details,
            suggestions: vec![
                "The container might have been manually removed".to_string(),
                "A previous operation might have failed".to_string(),
                "This can be fixed by restarting the setup".to_string(),
            ],
            actions: vec![
                ErrorAction::Retry {
                    label: "Recreate Container".to_string(),
                    command: "recreate_container".to_string(),
                },
                ErrorAction::RunCommand {
                    label: "List All Containers".to_string(),
                    command: "podman ps -a".to_string(),
                    description: "Shows all containers including stopped ones".to_string(),
                },
            ],
            can_retry: true,
            estimated_fix_time: Some("1 minute".to_string()),
        }
    }

    fn no_internet_error(_msg: String, technical_details: Option<String>) -> Self {
        Self {
            code: ErrorCode::NoInternetConnection,
            title: "No Internet Connection".to_string(),
            message:
                "Unable to connect to the internet. Some features require downloading AI models."
                    .to_string(),
            technical_details,
            suggestions: vec![
                "Check if your internet connection is working".to_string(),
                "Disable VPN if you're using one".to_string(),
                "Check firewall settings".to_string(),
            ],
            actions: vec![
                ErrorAction::RunCommand {
                    label: "Test Connection".to_string(),
                    command: if cfg!(windows) {
                        "ping google.com"
                    } else {
                        "ping -c 4 google.com"
                    }
                    .to_string(),
                    description: "Tests internet connectivity".to_string(),
                },
                ErrorAction::Retry {
                    label: "Try Again".to_string(),
                    command: "retry_operation".to_string(),
                },
            ],
            can_retry: true,
            estimated_fix_time: Some("Immediate once connected".to_string()),
        }
    }

    fn insufficient_disk_error(_msg: String, technical_details: Option<String>) -> Self {
        Self {
            code: ErrorCode::InsufficientDisk,
            title: "Not Enough Disk Space".to_string(),
            message:
                "Your system is running low on disk space. AI models require several GB of storage."
                    .to_string(),
            technical_details,
            suggestions: vec![
                "Delete unnecessary files to free up space".to_string(),
                "Empty your trash/recycle bin".to_string(),
                "Move large files to external storage".to_string(),
                "AI models typically need 5-10GB of free space".to_string(),
            ],
            actions: vec![
                ErrorAction::RunCommand {
                    label: "Check Disk Usage".to_string(),
                    command: if cfg!(windows) {
                        "explorer"
                    } else if cfg!(target_os = "macos") {
                        "open -a 'Disk Utility'"
                    } else {
                        "df -h"
                    }
                    .to_string(),
                    description: "Shows disk space usage".to_string(),
                },
                ErrorAction::OpenUrl {
                    label: "Disk Cleanup Guide".to_string(),
                    url: "https://docs.eliza.ai/disk-cleanup".to_string(),
                },
            ],
            can_retry: false,
            estimated_fix_time: Some("10-30 minutes".to_string()),
        }
    }

    fn generic_network_error(_msg: String, technical_details: Option<String>) -> Self {
        Self {
            code: ErrorCode::NetworkTimeout,
            title: "Network Error".to_string(),
            message: "There was a problem with the network connection.".to_string(),
            technical_details,
            suggestions: vec![
                "Check your internet connection".to_string(),
                "Try disabling VPN or proxy".to_string(),
                "Restart your router".to_string(),
            ],
            actions: vec![
                ErrorAction::Retry {
                    label: "Try Again".to_string(),
                    command: "retry_operation".to_string(),
                },
                ErrorAction::ShowLogs {
                    label: "View Network Logs".to_string(),
                    log_filter: Some("network".to_string()),
                },
            ],
            can_retry: true,
            estimated_fix_time: Some("1-5 minutes".to_string()),
        }
    }

    fn generic_resource_error(_msg: String, technical_details: Option<String>) -> Self {
        Self {
            code: ErrorCode::InsufficientMemory,
            title: "Resource Limitation".to_string(),
            message: "Your system doesn't have enough resources for this operation.".to_string(),
            technical_details,
            suggestions: vec![
                "Close other applications".to_string(),
                "Restart your computer to free up resources".to_string(),
                "Check system requirements".to_string(),
            ],
            actions: vec![
                ErrorAction::OpenUrl {
                    label: "System Requirements".to_string(),
                    url: "https://docs.eliza.ai/requirements".to_string(),
                },
                ErrorAction::ShowLogs {
                    label: "View System Logs".to_string(),
                    log_filter: None,
                },
            ],
            can_retry: false,
            estimated_fix_time: Some("5-15 minutes".to_string()),
        }
    }

    fn generic_error(msg: String, technical_details: Option<String>) -> Self {
        Self {
            code: ErrorCode::UnknownError,
            title: "Unexpected Error".to_string(),
            message: "Something went wrong, but we can help you fix it.".to_string(),
            technical_details,
            suggestions: vec![
                "Try restarting the application".to_string(),
                "Check the logs for more details".to_string(),
                "Contact support if the problem persists".to_string(),
            ],
            actions: vec![
                ErrorAction::ShowLogs {
                    label: "View Error Logs".to_string(),
                    log_filter: Some("error".to_string()),
                },
                ErrorAction::ContactSupport {
                    label: "Get Help".to_string(),
                    issue_template: format!("Error: {}", msg),
                },
            ],
            can_retry: true,
            estimated_fix_time: None,
        }
    }
}

// Helper functions
fn extract_port_from_message(msg: &str) -> Option<u16> {
    // Try to find a port number in the message
    let re = regex::Regex::new(r":(\d{4,5})|port\s+(\d{4,5})").ok()?;
    re.captures(msg)
        .and_then(|caps| caps.get(1).or(caps.get(2)))
        .and_then(|m| m.as_str().parse().ok())
}

fn get_alternative_port(original: u16) -> u16 {
    match original {
        5432 => 5432,   // PostgreSQL alternative
        11434 => 11435, // Ollama alternative
        7777 => 7778,   // Agent alternative
        p => p + 1000,  // Generic alternative
    }
}

/// Error handler that converts BackendErrors to UserErrors and emits them
pub async fn handle_user_error(
    err: BackendError,
    app_handle: Option<&tauri::AppHandle>,
) -> UserError {
    let user_error = UserError::from(err);

    // Log the technical details
    error!("Error occurred: {:?}", user_error.technical_details);
    info!(
        "User-friendly error: {} - {}",
        user_error.title, user_error.message
    );

    // Emit to frontend if app handle is available
    if let Some(app) = app_handle {
        let _ = app.emit("user-error", &user_error);
    }

    user_error
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_port_extraction() {
        assert_eq!(
            extract_port_from_message("port 5432 already in use"),
            Some(5432)
        );
        assert_eq!(
            extract_port_from_message("bind: address already in use :11434"),
            Some(11434)
        );
        assert_eq!(extract_port_from_message("no port here"), None);
    }

    #[test]
    fn test_error_conversion() {
        let backend_err = BackendError::Container("port 5432 already in use".to_string());
        let user_err = UserError::from(backend_err);

        assert_eq!(user_err.code, ErrorCode::PortConflict);
        assert!(user_err.title.contains("PostgreSQL"));
        assert!(user_err.can_retry);
        assert!(!user_err.actions.is_empty());
    }
}
