//! TUN interface management

use super::VPNError;

/// Platform-specific TUN interface
pub struct TunInterface {
    name: String,
    #[allow(dead_code)]
    mtu: u16,
}

impl TunInterface {
    /// Create a new TUN interface
    #[cfg(target_os = "linux")]
    pub fn create(name: &str, mtu: u16) -> Result<Self, VPNError> {
        tracing::info!("Creating TUN interface: {}", name);
        
        // TODO: Use tun crate to create actual interface
        // let config = tun::Configuration::default();
        // config.name(name);
        // config.mtu(mtu as i32);
        // config.up();
        // let dev = tun::create(&config)?;
        
        Ok(Self {
            name: name.to_string(),
            mtu,
        })
    }
    
    #[cfg(target_os = "macos")]
    pub fn create(name: &str, mtu: u16) -> Result<Self, VPNError> {
        tracing::info!("Creating TUN interface on macOS: {}", name);
        
        // macOS uses utun interfaces
        // TODO: Implement using tun crate with macOS support
        
        Ok(Self {
            name: name.to_string(),
            mtu,
        })
    }
    
    #[cfg(target_os = "windows")]
    pub fn create(name: &str, mtu: u16) -> Result<Self, VPNError> {
        tracing::info!("Creating TUN interface on Windows: {}", name);
        
        // Windows requires WinTun driver
        // TODO: Implement using wintun crate
        
        Ok(Self {
            name: name.to_string(),
            mtu,
        })
    }
    
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    pub fn create(name: &str, mtu: u16) -> Result<Self, VPNError> {
        Err(VPNError::TunnelError("Unsupported platform".to_string()))
    }
    
    /// Get interface name
    pub fn name(&self) -> &str {
        &self.name
    }
    
    /// Configure IP address on interface
    pub fn set_ip(&self, ip: &str, subnet: u8) -> Result<(), VPNError> {
        tracing::info!("Setting IP {}/{} on {}", ip, subnet, self.name);
        
        #[cfg(target_os = "linux")]
        {
            // Use ip command
            std::process::Command::new("ip")
                .args(["addr", "add", &format!("{}/{}", ip, subnet), "dev", &self.name])
                .output()
                .map_err(|e| VPNError::TunnelError(e.to_string()))?;
        }
        
        #[cfg(target_os = "macos")]
        {
            // Use ifconfig
            std::process::Command::new("ifconfig")
                .args([&self.name, ip, ip, "netmask", "255.255.255.0"])
                .output()
                .map_err(|e| VPNError::TunnelError(e.to_string()))?;
        }
        
        Ok(())
    }
    
    /// Add default route through this interface
    pub fn add_default_route(&self) -> Result<(), VPNError> {
        tracing::info!("Adding default route through {}", self.name);
        
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("ip")
                .args(["route", "add", "default", "dev", &self.name])
                .output()
                .map_err(|e| VPNError::TunnelError(e.to_string()))?;
        }
        
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("route")
                .args(["add", "-net", "0.0.0.0/1", "-interface", &self.name])
                .output()
                .map_err(|e| VPNError::TunnelError(e.to_string()))?;
            
            std::process::Command::new("route")
                .args(["add", "-net", "128.0.0.0/1", "-interface", &self.name])
                .output()
                .map_err(|e| VPNError::TunnelError(e.to_string()))?;
        }
        
        Ok(())
    }
    
    /// Bring interface up
    pub fn up(&self) -> Result<(), VPNError> {
        tracing::info!("Bringing up interface {}", self.name);
        
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("ip")
                .args(["link", "set", &self.name, "up"])
                .output()
                .map_err(|e| VPNError::TunnelError(e.to_string()))?;
        }
        
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("ifconfig")
                .args([&self.name, "up"])
                .output()
                .map_err(|e| VPNError::TunnelError(e.to_string()))?;
        }
        
        Ok(())
    }
    
    /// Destroy the interface
    pub fn destroy(&self) -> Result<(), VPNError> {
        tracing::info!("Destroying interface {}", self.name);
        
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("ip")
                .args(["link", "delete", &self.name])
                .output()
                .map_err(|e| VPNError::TunnelError(e.to_string()))?;
        }
        
        Ok(())
    }
}

