//! TUN interface management

use super::VPNError;
use std::net::Ipv4Addr;

/// SECURITY: Validate interface name to prevent command injection
/// Only allows alphanumeric characters and underscores, max 15 chars
fn validate_interface_name(name: &str) -> Result<(), VPNError> {
    if name.is_empty() || name.len() > 15 {
        return Err(VPNError::TunnelError(
            "Interface name must be 1-15 characters".to_string(),
        ));
    }

    // Only allow alphanumeric, underscore, and hyphen (no shell metacharacters)
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(VPNError::TunnelError(
            "Interface name contains invalid characters. Only alphanumeric, underscore, and hyphen allowed.".to_string()
        ));
    }

    Ok(())
}

/// SECURITY: Validate IPv4 address format to prevent injection
fn validate_ipv4_address(ip: &str) -> Result<Ipv4Addr, VPNError> {
    ip.parse::<Ipv4Addr>()
        .map_err(|_| VPNError::TunnelError(format!("Invalid IPv4 address: {}", ip)))
}

/// SECURITY: Validate subnet mask (must be 0-32)
fn validate_subnet(subnet: u8) -> Result<(), VPNError> {
    if subnet > 32 {
        return Err(VPNError::TunnelError(format!(
            "Invalid subnet mask: {}. Must be 0-32.",
            subnet
        )));
    }
    Ok(())
}

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
        // SECURITY: Validate interface name before use
        validate_interface_name(name)?;

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
        // SECURITY: Validate interface name before use
        validate_interface_name(name)?;

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
        // SECURITY: Validate interface name before use
        validate_interface_name(name)?;

        tracing::info!("Creating TUN interface on Windows: {}", name);

        // Windows requires WinTun driver
        // TODO: Implement using wintun crate

        Ok(Self {
            name: name.to_string(),
            mtu,
        })
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    pub fn create(_name: &str, _mtu: u16) -> Result<Self, VPNError> {
        Err(VPNError::TunnelError("Unsupported platform".to_string()))
    }

    /// Get interface name
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Configure IP address on interface
    pub fn set_ip(&self, ip: &str, subnet: u8) -> Result<(), VPNError> {
        // SECURITY: Validate inputs before passing to shell commands
        let validated_ip = validate_ipv4_address(ip)?;
        validate_subnet(subnet)?;

        tracing::info!("Setting IP {}/{} on {}", validated_ip, subnet, self.name);

        #[cfg(target_os = "linux")]
        {
            // Use ip command with validated inputs
            let ip_cidr = format!("{}/{}", validated_ip, subnet);
            std::process::Command::new("ip")
                .args(["addr", "add", &ip_cidr, "dev", &self.name])
                .output()
                .map_err(|e| VPNError::TunnelError(e.to_string()))?;
        }

        #[cfg(target_os = "macos")]
        {
            // Use ifconfig with validated inputs
            let ip_str = validated_ip.to_string();
            std::process::Command::new("ifconfig")
                .args([&self.name, &ip_str, &ip_str, "netmask", "255.255.255.0"])
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
