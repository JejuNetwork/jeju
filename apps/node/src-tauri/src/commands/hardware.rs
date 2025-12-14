//! Hardware detection commands

use crate::hardware::{HardwareDetector, HardwareInfo, TeeCapabilities};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub os_version: String,
    pub hostname: String,
    pub arch: String,
    pub cpu_name: String,
    pub cpu_cores: u32,
    pub memory_gb: f64,
    pub gpu_count: usize,
}

#[tauri::command]
pub async fn detect_hardware() -> Result<HardwareInfo, String> {
    let mut detector = HardwareDetector::new();
    Ok(detector.detect())
}

#[tauri::command]
pub async fn detect_tee() -> Result<TeeCapabilities, String> {
    let mut detector = HardwareDetector::new();
    let info = detector.detect();
    Ok(info.tee)
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    let mut detector = HardwareDetector::new();
    let info = detector.detect();
    
    Ok(SystemInfo {
        os: info.os,
        os_version: info.os_version,
        hostname: info.hostname,
        arch: info.cpu.architecture,
        cpu_name: info.cpu.name,
        cpu_cores: info.cpu.cores_physical,
        memory_gb: info.memory.total_mb as f64 / 1024.0,
        gpu_count: info.gpus.len(),
    })
}

