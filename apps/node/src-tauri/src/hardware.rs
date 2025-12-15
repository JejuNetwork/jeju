//! Hardware detection for GPUs, CPUs, TEE capabilities

use serde::{Deserialize, Serialize};
use sysinfo::{System, Disks, Networks};

/// GPU information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub index: u32,
    pub name: String,
    pub vendor: String,
    pub memory_total_mb: u64,
    pub memory_used_mb: u64,
    pub utilization_percent: u32,
    pub temperature_celsius: Option<u32>,
    pub driver_version: Option<String>,
    pub cuda_version: Option<String>,
    pub compute_capability: Option<String>,
    pub suitable_for_inference: bool,
}

/// CPU information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuInfo {
    pub name: String,
    pub vendor: String,
    pub cores_physical: u32,
    pub cores_logical: u32,
    pub frequency_mhz: u64,
    pub usage_percent: f32,
    pub architecture: String,
}

/// Memory information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryInfo {
    pub total_mb: u64,
    pub used_mb: u64,
    pub available_mb: u64,
    pub usage_percent: f32,
}

/// Storage information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageInfo {
    pub mount_point: String,
    pub total_gb: u64,
    pub used_gb: u64,
    pub available_gb: u64,
    pub filesystem: String,
    pub is_ssd: bool,
}

/// Network interface information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInterfaceInfo {
    pub name: String,
    pub mac_address: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
}

/// TEE (Trusted Execution Environment) capabilities
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeeCapabilities {
    pub has_intel_tdx: bool,
    pub has_intel_sgx: bool,
    pub has_amd_sev: bool,
    pub has_nvidia_cc: bool,
    pub attestation_available: bool,
    pub tdx_version: Option<String>,
    pub sgx_version: Option<String>,
}

/// Complete hardware information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub os: String,
    pub os_version: String,
    pub hostname: String,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub gpus: Vec<GpuInfo>,
    pub storage: Vec<StorageInfo>,
    pub network: Vec<NetworkInterfaceInfo>,
    pub tee: TeeCapabilities,
}

/// Service requirements
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceRequirements {
    pub min_cpu_cores: u32,
    pub min_memory_mb: u64,
    pub min_storage_gb: u64,
    pub requires_gpu: bool,
    pub min_gpu_memory_mb: Option<u64>,
    pub requires_tee: bool,
    pub min_bandwidth_mbps: Option<u32>,
}

/// Hardware detector
pub struct HardwareDetector {
    system: System,
}

impl HardwareDetector {
    pub fn new() -> Self {
        Self {
            system: System::new_all(),
        }
    }

    pub fn detect(&mut self) -> HardwareInfo {
        self.system.refresh_all();
        
        HardwareInfo {
            os: std::env::consts::OS.to_string(),
            os_version: System::os_version().unwrap_or_default(),
            hostname: System::host_name().unwrap_or_default(),
            cpu: self.detect_cpu(),
            memory: self.detect_memory(),
            gpus: self.detect_gpus(),
            storage: self.detect_storage(),
            network: self.detect_network(),
            tee: self.detect_tee(),
        }
    }

    fn detect_cpu(&self) -> CpuInfo {
        let cpus = self.system.cpus();
        let first_cpu = cpus.first();
        
        let total_usage: f32 = cpus.iter().map(|c| c.cpu_usage()).sum();
        let avg_usage = if cpus.is_empty() { 0.0 } else { total_usage / cpus.len() as f32 };
        
        CpuInfo {
            name: first_cpu.map(|c| c.brand().to_string()).unwrap_or_default(),
            vendor: first_cpu.map(|c| c.vendor_id().to_string()).unwrap_or_default(),
            cores_physical: self.system.physical_core_count().unwrap_or(0) as u32,
            cores_logical: cpus.len() as u32,
            frequency_mhz: first_cpu.map(|c| c.frequency()).unwrap_or(0),
            usage_percent: avg_usage,
            architecture: std::env::consts::ARCH.to_string(),
        }
    }

    fn detect_memory(&self) -> MemoryInfo {
        let total = self.system.total_memory() / 1024 / 1024;
        let used = self.system.used_memory() / 1024 / 1024;
        let available = self.system.available_memory() / 1024 / 1024;
        
        MemoryInfo {
            total_mb: total,
            used_mb: used,
            available_mb: available,
            usage_percent: if total > 0 { (used as f32 / total as f32) * 100.0 } else { 0.0 },
        }
    }

    fn detect_gpus(&self) -> Vec<GpuInfo> {
        let mut gpus = Vec::new();
        
        #[cfg(feature = "nvidia")]
        {
            if let Ok(nvml) = nvml_wrapper::Nvml::init() {
                if let Ok(count) = nvml.device_count() {
                    for i in 0..count {
                        if let Ok(device) = nvml.device_by_index(i) {
                            let name = device.name().unwrap_or_default();
                            let memory = device.memory_info().ok();
                            let utilization = device.utilization_rates().ok();
                            let temperature = device.temperature(nvml_wrapper::enum_wrappers::device::TemperatureSensor::Gpu).ok();
                            let driver = nvml.sys_driver_version().ok();
                            let cuda = nvml.sys_cuda_driver_version().ok();
                            
                            let memory_total_mb = memory.as_ref().map(|m| m.total / 1024 / 1024).unwrap_or(0);
                            
                            gpus.push(GpuInfo {
                                index: i,
                                name,
                                vendor: "NVIDIA".to_string(),
                                memory_total_mb,
                                memory_used_mb: memory.as_ref().map(|m| m.used / 1024 / 1024).unwrap_or(0),
                                utilization_percent: utilization.map(|u| u.gpu).unwrap_or(0),
                                temperature_celsius: temperature,
                                driver_version: driver,
                                cuda_version: cuda.map(|v| format!("{}.{}", v.major, v.minor)),
                                compute_capability: None,
                                suitable_for_inference: memory_total_mb >= 8000, // 8GB minimum
                            });
                        }
                    }
                }
            }
        }
        
        // Fallback: Try to detect GPUs via system info
        if gpus.is_empty() {
            // Check for AMD GPUs via sysfs on Linux
            #[cfg(target_os = "linux")]
            {
                if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.join("device/vendor").exists() {
                            if let Ok(vendor) = std::fs::read_to_string(path.join("device/vendor")) {
                                let vendor = vendor.trim();
                                if vendor == "0x1002" { // AMD
                                    gpus.push(GpuInfo {
                                        index: gpus.len() as u32,
                                        name: "AMD GPU".to_string(),
                                        vendor: "AMD".to_string(),
                                        memory_total_mb: 0,
                                        memory_used_mb: 0,
                                        utilization_percent: 0,
                                        temperature_celsius: None,
                                        driver_version: None,
                                        cuda_version: None,
                                        compute_capability: None,
                                        suitable_for_inference: false,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        
        gpus
    }

    fn detect_storage(&self) -> Vec<StorageInfo> {
        let disks = Disks::new_with_refreshed_list();
        
        disks.list().iter().map(|disk| {
            let total = disk.total_space() / 1024 / 1024 / 1024;
            let available = disk.available_space() / 1024 / 1024 / 1024;
            
            StorageInfo {
                mount_point: disk.mount_point().to_string_lossy().to_string(),
                total_gb: total,
                used_gb: total - available,
                available_gb: available,
                filesystem: disk.file_system().to_string_lossy().to_string(),
                is_ssd: disk.is_removable() == false && disk.kind() == sysinfo::DiskKind::SSD,
            }
        }).collect()
    }

    fn detect_network(&self) -> Vec<NetworkInterfaceInfo> {
        let networks = Networks::new_with_refreshed_list();
        
        networks.list().iter().map(|(name, data)| {
            NetworkInterfaceInfo {
                name: name.clone(),
                mac_address: data.mac_address().to_string(),
                bytes_sent: data.total_transmitted(),
                bytes_received: data.total_received(),
            }
        }).collect()
    }

    fn detect_tee(&self) -> TeeCapabilities {
        let mut caps = TeeCapabilities {
            has_intel_tdx: false,
            has_intel_sgx: false,
            has_amd_sev: false,
            has_nvidia_cc: false,
            attestation_available: false,
            tdx_version: None,
            sgx_version: None,
        };

        // Check for Intel TDX
        #[cfg(target_os = "linux")]
        {
            // Check TDX device
            if std::path::Path::new("/dev/tdx_guest").exists() ||
               std::path::Path::new("/dev/tdx-guest").exists() {
                caps.has_intel_tdx = true;
                caps.attestation_available = true;
                
                // Try to get TDX version
                if let Ok(output) = std::process::Command::new("cat")
                    .arg("/sys/firmware/tdx/version")
                    .output() {
                    if output.status.success() {
                        caps.tdx_version = Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
                    }
                }
            }
            
            // Check for Intel SGX
            if std::path::Path::new("/dev/sgx_enclave").exists() ||
               std::path::Path::new("/dev/isgx").exists() {
                caps.has_intel_sgx = true;
                caps.attestation_available = true;
            }
            
            // Check for AMD SEV
            if std::path::Path::new("/dev/sev").exists() ||
               std::path::Path::new("/dev/sev-guest").exists() {
                caps.has_amd_sev = true;
                caps.attestation_available = true;
            }
        }

        // Check for NVIDIA Confidential Computing
        #[cfg(feature = "nvidia")]
        {
            if let Ok(nvml) = nvml_wrapper::Nvml::init() {
                if let Ok(count) = nvml.device_count() {
                    for i in 0..count {
                        if let Ok(device) = nvml.device_by_index(i) {
                            // Check for H100 or other CC-capable GPUs
                            if let Ok(name) = device.name() {
                                if name.contains("H100") || name.contains("H200") {
                                    caps.has_nvidia_cc = true;
                                    caps.attestation_available = true;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        caps
    }

    /// Check if hardware meets requirements for a service
    pub fn meets_requirements(&self, info: &HardwareInfo, reqs: &ServiceRequirements) -> (bool, Vec<String>) {
        let mut issues = Vec::new();
        
        if info.cpu.cores_physical < reqs.min_cpu_cores {
            issues.push(format!(
                "Need {} CPU cores, have {}",
                reqs.min_cpu_cores, info.cpu.cores_physical
            ));
        }
        
        if info.memory.total_mb < reqs.min_memory_mb {
            issues.push(format!(
                "Need {} MB RAM, have {} MB",
                reqs.min_memory_mb, info.memory.total_mb
            ));
        }
        
        let max_storage = info.storage.iter().map(|s| s.available_gb).max().unwrap_or(0);
        if max_storage < reqs.min_storage_gb {
            issues.push(format!(
                "Need {} GB storage, have {} GB",
                reqs.min_storage_gb, max_storage
            ));
        }
        
        if reqs.requires_gpu {
            if info.gpus.is_empty() {
                issues.push("GPU required but none detected".to_string());
            } else if let Some(min_mem) = reqs.min_gpu_memory_mb {
                let max_gpu_mem = info.gpus.iter().map(|g| g.memory_total_mb).max().unwrap_or(0);
                if max_gpu_mem < min_mem {
                    issues.push(format!(
                        "Need {} MB GPU memory, have {} MB",
                        min_mem, max_gpu_mem
                    ));
                }
            }
        }
        
        if reqs.requires_tee && !info.tee.attestation_available {
            issues.push("TEE (TDX/SGX/SEV) required but not available".to_string());
        }
        
        (issues.is_empty(), issues)
    }
}

impl Default for HardwareDetector {
    fn default() -> Self {
        Self::new()
    }
}

