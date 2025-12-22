//! Service management commands

use crate::hardware::HardwareDetector;
use crate::services::{ServiceId, ServiceMetadata, ServiceState};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct StartServiceRequest {
    pub service_id: String,
    pub auto_stake: bool,
    pub stake_amount: Option<String>,
    pub custom_settings: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServiceWithStatus {
    pub metadata: ServiceMetadata,
    pub status: ServiceState,
    pub meets_requirements: bool,
    pub requirement_issues: Vec<String>,
}

#[tauri::command]
pub async fn get_available_services(
    state: State<'_, AppState>,
) -> Result<Vec<ServiceWithStatus>, String> {
    let inner = state.inner.read();

    // Detect current hardware
    let mut detector = HardwareDetector::new();
    let hardware = detector.detect();

    // Get all services with their metadata and requirements
    let services: Vec<ServiceWithStatus> = inner
        .service_manager
        .get_available_services(&hardware)
        .into_iter()
        .map(|metadata| {
            let service_id: ServiceId = metadata.id.parse().unwrap_or(ServiceId::Compute);

            // Check requirements
            let reqs = match service_id {
                ServiceId::Compute => crate::hardware::ServiceRequirements {
                    min_cpu_cores: 8,
                    min_memory_mb: 32 * 1024,
                    min_storage_gb: 100,
                    requires_gpu: true,
                    min_gpu_memory_mb: Some(8 * 1024),
                    requires_tee: false,
                    min_bandwidth_mbps: Some(100),
                },
                ServiceId::Sequencer => crate::hardware::ServiceRequirements {
                    min_cpu_cores: 8,
                    min_memory_mb: 32 * 1024,
                    min_storage_gb: 2000,
                    requires_gpu: false,
                    min_gpu_memory_mb: None,
                    requires_tee: false,
                    min_bandwidth_mbps: Some(1000),
                },
                _ => crate::hardware::ServiceRequirements {
                    min_cpu_cores: 2,
                    min_memory_mb: 4 * 1024,
                    min_storage_gb: 50,
                    requires_gpu: false,
                    min_gpu_memory_mb: None,
                    requires_tee: false,
                    min_bandwidth_mbps: Some(10),
                },
            };

            let (meets, issues) = detector.meets_requirements(&hardware, &reqs);

            ServiceWithStatus {
                metadata: metadata.clone(),
                status: ServiceState {
                    running: false,
                    uptime_seconds: 0,
                    requests_served: 0,
                    earnings_wei: "0".to_string(),
                    last_error: None,
                    health: "stopped".to_string(),
                },
                meets_requirements: meets,
                requirement_issues: issues,
            }
        })
        .collect();

    Ok(services)
}

#[tauri::command]
pub async fn start_service(
    state: State<'_, AppState>,
    request: StartServiceRequest,
) -> Result<ServiceState, String> {
    let mut inner = state.inner.write();

    // Parse service ID
    let service_id: ServiceId = request.service_id.parse()?;

    // Get or create service config
    let config = inner
        .config
        .services
        .entry(request.service_id.clone())
        .or_insert_with(crate::config::ServiceConfig::default);

    config.enabled = true;
    config.stake_amount = request.stake_amount;

    if let Some(settings) = request.custom_settings {
        config.custom_settings = settings;
    }

    // Save config
    inner.config.save().map_err(|e| e.to_string())?;

    // Clone config for service start
    let service_config = config.clone();

    // Start service
    inner
        .service_manager
        .start_service(service_id, &service_config)
        .await?;

    // Get status
    inner.service_manager.get_service_status(service_id).await
}

#[tauri::command]
pub async fn stop_service(
    state: State<'_, AppState>,
    service_id: String,
) -> Result<ServiceState, String> {
    let mut inner = state.inner.write();

    let id: ServiceId = service_id.parse()?;

    // Update config
    if let Some(config) = inner.config.services.get_mut(&service_id) {
        config.enabled = false;
    }
    inner.config.save().map_err(|e| e.to_string())?;

    // Stop service
    inner.service_manager.stop_service(id).await?;

    // Get status
    inner.service_manager.get_service_status(id).await
}

#[tauri::command]
pub async fn get_service_status(
    state: State<'_, AppState>,
    service_id: String,
) -> Result<ServiceState, String> {
    let inner = state.inner.read();

    let id: ServiceId = service_id.parse()?;
    inner.service_manager.get_service_status(id).await
}

#[tauri::command]
pub async fn get_all_service_status(
    state: State<'_, AppState>,
) -> Result<HashMap<String, ServiceState>, String> {
    let inner = state.inner.read();
    Ok(inner.service_manager.get_all_status().await)
}
