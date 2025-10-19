use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RuntimeDetectionStatus {
    pub bundled_available: bool,
    pub bundled_path: Option<String>,
    pub system_available: bool,
    pub system_path: Option<String>,
    pub system_type: Option<String>, // "podman" or "docker"
    pub active_runtime: Option<String>,
    pub active_path: Option<String>,
    pub detection_completed: bool,
    pub error_message: Option<String>,
}

impl RuntimeDetectionStatus {
    #[must_use]
    pub fn new_with_bundled(path: &Path) -> Self {
        Self {
            bundled_available: true,
            bundled_path: Some(path.to_string_lossy().to_string()),
            active_runtime: Some("bundled".to_string()),
            active_path: Some(path.to_string_lossy().to_string()),
            detection_completed: true,
            ..Default::default()
        }
    }

    #[must_use]
    pub fn new_with_system(path: &Path, runtime_type: &str) -> Self {
        Self {
            system_available: true,
            system_path: Some(path.to_string_lossy().to_string()),
            system_type: Some(runtime_type.to_string()),
            active_runtime: Some("system".to_string()),
            active_path: Some(path.to_string_lossy().to_string()),
            detection_completed: true,
            ..Default::default()
        }
    }

    #[must_use]
    pub fn new_with_downloaded(path: &Path) -> Self {
        Self {
            bundled_available: true, // Downloaded runtime becomes the bundled runtime
            bundled_path: Some(path.to_string_lossy().to_string()),
            active_runtime: Some("downloaded".to_string()),
            active_path: Some(path.to_string_lossy().to_string()),
            detection_completed: true,
            ..Default::default()
        }
    }

    #[must_use]
    pub fn new_with_error(error: String) -> Self {
        Self {
            detection_completed: true,
            error_message: Some(error),
            ..Default::default()
        }
    }
}
