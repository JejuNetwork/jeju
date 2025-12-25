//! Cross-platform TUN interface management
//!
//! Provides platform-specific TUN device creation and configuration for:
//! - Linux (using /dev/net/tun)
//! - macOS (using utun)
//! - Windows (using WinTun)
//!
//! # Implementation Status
//!
//! The TUN interface code is structured but not fully implemented:
//! - Interface creation: Returns Ok but doesn't create actual TUN device
//! - IP/route configuration: Uses system commands (ip, ifconfig, route)
//! - Read/write operations: Placeholder implementations
//!
//! # TODO: Complete TUN Implementation
//!
//! To complete the implementation, integrate the `tun` crate for Linux/macOS
//! or the `wintun` crate for Windows. Example for Linux:
//! ```ignore
//! use tun::Configuration;
//! let mut config = Configuration::default();
//! config.name("jeju0").address((10, 0, 0, 2)).mtu(1420).up();
//! let dev = tun::create(&config)?;
//! ```

use super::VPNError;
use std::net::Ipv4Addr;

/// Maximum transmission unit for tunnel interface
pub const TUNNEL_MTU: u16 = 1420;

/// Validate interface name to prevent command injection
/// Only allows alphanumeric characters and underscores, max 15 chars
fn validate_interface_name(name: &str) -> Result<(), VPNError> {
    if name.is_empty() || name.len() > 15 {
        return Err(VPNError::TunnelError(
            "Interface name must be 1-15 characters".to_string(),
        ));
    }

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

/// Validate IPv4 address format
fn validate_ipv4_address(ip: &str) -> Result<Ipv4Addr, VPNError> {
    ip.parse::<Ipv4Addr>()
        .map_err(|_| VPNError::TunnelError(format!("Invalid IPv4 address: {}", ip)))
}

/// Validate subnet mask (0-32)
fn validate_subnet(subnet: u8) -> Result<(), VPNError> {
    if subnet > 32 {
        return Err(VPNError::TunnelError(format!(
            "Invalid subnet mask: {}. Must be 0-32.",
            subnet
        )));
    }
    Ok(())
}

/// TUN interface configuration
#[derive(Debug, Clone)]
pub struct TunConfig {
    pub name: String,
    pub address: Ipv4Addr,
    pub netmask: Ipv4Addr,
    pub mtu: u16,
    pub dns: Vec<Ipv4Addr>,
}

impl Default for TunConfig {
    fn default() -> Self {
        Self {
            name: "jeju0".to_string(),
            address: Ipv4Addr::new(10, 0, 0, 2),
            netmask: Ipv4Addr::new(255, 255, 255, 0),
            mtu: TUNNEL_MTU,
            dns: vec![Ipv4Addr::new(1, 1, 1, 1), Ipv4Addr::new(8, 8, 8, 8)],
        }
    }
}

/// Platform-specific TUN interface
pub struct TunInterface {
    name: String,
    mtu: u16,
    #[cfg(target_os = "linux")]
    fd: Option<std::os::unix::io::RawFd>,
    #[cfg(target_os = "macos")]
    fd: Option<std::os::unix::io::RawFd>,
    #[cfg(target_os = "windows")]
    session: Option<()>, // WinTun session placeholder
}

impl TunInterface {
    /// Create a new TUN interface
    #[cfg(target_os = "linux")]
    pub fn create(config: &TunConfig) -> Result<Self, VPNError> {
        validate_interface_name(&config.name)?;

        tracing::info!("Creating TUN interface on Linux: {}", config.name);

        // In production, this would use ioctl to create the TUN interface:
        // 1. Open /dev/net/tun
        // 2. Use TUNSETIFF ioctl to configure
        // 3. Set up the interface with ip addr and ip link

        Ok(Self {
            name: config.name.clone(),
            mtu: config.mtu,
            fd: None, // Would be the actual fd from open()
        })
    }

    #[cfg(target_os = "macos")]
    pub fn create(config: &TunConfig) -> Result<Self, VPNError> {
        validate_interface_name(&config.name)?;

        tracing::info!("Creating TUN interface on macOS: {}", config.name);

        // macOS uses utun interfaces via the Network Extension framework
        // or by opening a PF_SYSTEM socket

        Ok(Self {
            name: config.name.clone(),
            mtu: config.mtu,
            fd: None,
        })
    }

    #[cfg(target_os = "windows")]
    pub fn create(config: &TunConfig) -> Result<Self, VPNError> {
        validate_interface_name(&config.name)?;

        tracing::info!("Creating TUN interface on Windows: {}", config.name);

        // Windows requires the WinTun driver
        // Use wintun crate to create and manage the adapter

        Ok(Self {
            name: config.name.clone(),
            mtu: config.mtu,
            session: None,
        })
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    pub fn create(_config: &TunConfig) -> Result<Self, VPNError> {
        Err(VPNError::TunnelError("Unsupported platform".to_string()))
    }

    /// Get interface name
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Get MTU
    pub fn mtu(&self) -> u16 {
        self.mtu
    }

    /// Configure IP address on interface
    pub fn set_ip(&self, ip: &str, subnet: u8) -> Result<(), VPNError> {
        let validated_ip = validate_ipv4_address(ip)?;
        validate_subnet(subnet)?;

        tracing::info!("Setting IP {}/{} on {}", validated_ip, subnet, self.name);

        #[cfg(target_os = "linux")]
        {
            let ip_cidr = format!("{}/{}", validated_ip, subnet);
            std::process::Command::new("ip")
                .args(["addr", "add", &ip_cidr, "dev", &self.name])
                .output()
                .map_err(|e| VPNError::TunnelError(format!("Failed to set IP: {}", e)))?;
        }

        #[cfg(target_os = "macos")]
        {
            let ip_str = validated_ip.to_string();
            std::process::Command::new("ifconfig")
                .args([&self.name, &ip_str, &ip_str, "netmask", "255.255.255.0"])
                .output()
                .map_err(|e| VPNError::TunnelError(format!("Failed to set IP: {}", e)))?;
        }

        #[cfg(target_os = "windows")]
        {
            // Windows: Use netsh or WinTun API
            let _ = validated_ip;
        }

        Ok(())
    }

    /// Set DNS servers
    pub fn set_dns(&self, dns_servers: &[Ipv4Addr]) -> Result<(), VPNError> {
        if dns_servers.is_empty() {
            return Ok(());
        }

        tracing::info!("Setting DNS servers: {:?}", dns_servers);

        #[cfg(target_os = "linux")]
        {
            // On Linux, modify /etc/resolv.conf or use systemd-resolved
            // For now, log that this should be done
            tracing::debug!("DNS configuration on Linux requires modifying resolv.conf");
        }

        #[cfg(target_os = "macos")]
        {
            // On macOS, use scutil to set DNS
            for (i, dns) in dns_servers.iter().enumerate() {
                tracing::debug!("DNS server {}: {}", i, dns);
            }
        }

        #[cfg(target_os = "windows")]
        {
            // On Windows, use netsh interface ip set dns
            let _ = dns_servers;
        }

        Ok(())
    }

    /// Add default route through this interface
    pub fn add_default_route(&self, gateway: Option<Ipv4Addr>) -> Result<(), VPNError> {
        tracing::info!("Adding default route through {}", self.name);

        #[cfg(target_os = "linux")]
        {
            if let Some(gw) = gateway {
                std::process::Command::new("ip")
                    .args([
                        "route",
                        "add",
                        "default",
                        "via",
                        &gw.to_string(),
                        "dev",
                        &self.name,
                    ])
                    .output()
                    .map_err(|e| VPNError::TunnelError(format!("Failed to add route: {}", e)))?;
            } else {
                std::process::Command::new("ip")
                    .args(["route", "add", "default", "dev", &self.name])
                    .output()
                    .map_err(|e| VPNError::TunnelError(format!("Failed to add route: {}", e)))?;
            }
        }

        #[cfg(target_os = "macos")]
        {
            // On macOS, add routes for 0.0.0.0/1 and 128.0.0.0/1 to avoid replacing default route
            std::process::Command::new("route")
                .args(["add", "-net", "0.0.0.0/1", "-interface", &self.name])
                .output()
                .map_err(|e| VPNError::TunnelError(format!("Failed to add route: {}", e)))?;

            std::process::Command::new("route")
                .args(["add", "-net", "128.0.0.0/1", "-interface", &self.name])
                .output()
                .map_err(|e| VPNError::TunnelError(format!("Failed to add route: {}", e)))?;

            let _ = gateway;
        }

        #[cfg(target_os = "windows")]
        {
            // Windows: Use route add command
            let _ = gateway;
        }

        Ok(())
    }

    /// Add a specific route to bypass the VPN (e.g., for the VPN server itself)
    pub fn add_bypass_route(
        &self,
        destination: Ipv4Addr,
        gateway: Ipv4Addr,
    ) -> Result<(), VPNError> {
        tracing::info!("Adding bypass route for {} via {}", destination, gateway);

        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("ip")
                .args([
                    "route",
                    "add",
                    &format!("{}/32", destination),
                    "via",
                    &gateway.to_string(),
                ])
                .output()
                .map_err(|e| VPNError::TunnelError(format!("Failed to add bypass route: {}", e)))?;
        }

        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("route")
                .args([
                    "add",
                    "-host",
                    &destination.to_string(),
                    &gateway.to_string(),
                ])
                .output()
                .map_err(|e| VPNError::TunnelError(format!("Failed to add bypass route: {}", e)))?;
        }

        #[cfg(target_os = "windows")]
        {
            let _ = (destination, gateway);
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
                .map_err(|e| {
                    VPNError::TunnelError(format!("Failed to bring up interface: {}", e))
                })?;

            std::process::Command::new("ip")
                .args(["link", "set", &self.name, "mtu", &self.mtu.to_string()])
                .output()
                .map_err(|e| VPNError::TunnelError(format!("Failed to set MTU: {}", e)))?;
        }

        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("ifconfig")
                .args([&self.name, "up"])
                .output()
                .map_err(|e| {
                    VPNError::TunnelError(format!("Failed to bring up interface: {}", e))
                })?;

            std::process::Command::new("ifconfig")
                .args([&self.name, "mtu", &self.mtu.to_string()])
                .output()
                .map_err(|e| VPNError::TunnelError(format!("Failed to set MTU: {}", e)))?;
        }

        Ok(())
    }

    /// Bring interface down
    pub fn down(&self) -> Result<(), VPNError> {
        tracing::info!("Bringing down interface {}", self.name);

        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("ip")
                .args(["link", "set", &self.name, "down"])
                .output()
                .map_err(|e| {
                    VPNError::TunnelError(format!("Failed to bring down interface: {}", e))
                })?;
        }

        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("ifconfig")
                .args([&self.name, "down"])
                .output()
                .map_err(|e| {
                    VPNError::TunnelError(format!("Failed to bring down interface: {}", e))
                })?;
        }

        Ok(())
    }

    /// Remove all routes through this interface
    pub fn remove_routes(&self) -> Result<(), VPNError> {
        tracing::info!("Removing routes for {}", self.name);

        #[cfg(target_os = "linux")]
        {
            // Remove default route
            let _ = std::process::Command::new("ip")
                .args(["route", "del", "default", "dev", &self.name])
                .output();
        }

        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("route")
                .args(["delete", "-net", "0.0.0.0/1", "-interface", &self.name])
                .output();

            let _ = std::process::Command::new("route")
                .args(["delete", "-net", "128.0.0.0/1", "-interface", &self.name])
                .output();
        }

        Ok(())
    }

    /// Destroy the interface
    pub fn destroy(&self) -> Result<(), VPNError> {
        tracing::info!("Destroying interface {}", self.name);

        // First remove routes and bring down
        let _ = self.remove_routes();
        let _ = self.down();

        #[cfg(target_os = "linux")]
        {
            let _ = std::process::Command::new("ip")
                .args(["link", "delete", &self.name])
                .output();
        }

        // macOS: utun interfaces are destroyed when the fd is closed
        // Windows: WinTun adapter is destroyed when the session is closed

        Ok(())
    }
}

impl Drop for TunInterface {
    fn drop(&mut self) {
        // Best-effort cleanup
        let _ = self.destroy();
    }
}

/// Routing table management for kill switch functionality
pub struct RouteManager {
    original_gateway: Option<Ipv4Addr>,
    interface_name: String,
}

impl RouteManager {
    pub fn new(interface_name: &str) -> Self {
        Self {
            original_gateway: None,
            interface_name: interface_name.to_string(),
        }
    }

    /// Save the current default gateway before modifying routes
    pub fn save_original_gateway(&mut self) -> Result<(), VPNError> {
        #[cfg(target_os = "linux")]
        {
            let output = std::process::Command::new("ip")
                .args(["route", "show", "default"])
                .output()
                .map_err(|e| {
                    VPNError::TunnelError(format!("Failed to get default route: {}", e))
                })?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            // Parse "default via X.X.X.X dev ..."
            for word in stdout.split_whitespace() {
                if let Ok(ip) = word.parse::<Ipv4Addr>() {
                    self.original_gateway = Some(ip);
                    tracing::info!("Saved original gateway: {}", ip);
                    break;
                }
            }
        }

        #[cfg(target_os = "macos")]
        {
            let output = std::process::Command::new("route")
                .args(["-n", "get", "default"])
                .output()
                .map_err(|e| {
                    VPNError::TunnelError(format!("Failed to get default route: {}", e))
                })?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.contains("gateway:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(ip) = parts[1].parse::<Ipv4Addr>() {
                            self.original_gateway = Some(ip);
                            tracing::info!("Saved original gateway: {}", ip);
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Restore the original default gateway
    pub fn restore_original_gateway(&self) -> Result<(), VPNError> {
        if let Some(gateway) = self.original_gateway {
            tracing::info!("Restoring original gateway: {}", gateway);

            #[cfg(target_os = "linux")]
            {
                let _ = std::process::Command::new("ip")
                    .args(["route", "del", "default"])
                    .output();

                std::process::Command::new("ip")
                    .args(["route", "add", "default", "via", &gateway.to_string()])
                    .output()
                    .map_err(|e| {
                        VPNError::TunnelError(format!("Failed to restore gateway: {}", e))
                    })?;
            }

            #[cfg(target_os = "macos")]
            {
                let _ = std::process::Command::new("route")
                    .args(["delete", "default"])
                    .output();

                std::process::Command::new("route")
                    .args(["add", "default", &gateway.to_string()])
                    .output()
                    .map_err(|e| {
                        VPNError::TunnelError(format!("Failed to restore gateway: {}", e))
                    })?;
            }
        }

        Ok(())
    }

    /// Get the saved original gateway
    pub fn original_gateway(&self) -> Option<Ipv4Addr> {
        self.original_gateway
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_interface_name() {
        assert!(validate_interface_name("jeju0").is_ok());
        assert!(validate_interface_name("wg0").is_ok());
        assert!(validate_interface_name("tun-vpn").is_ok());

        // Too long
        assert!(validate_interface_name("thisiswaytoolongname").is_err());
        // Empty
        assert!(validate_interface_name("").is_err());
        // Invalid characters
        assert!(validate_interface_name("bad;name").is_err());
        assert!(validate_interface_name("bad name").is_err());
    }

    #[test]
    fn test_validate_ipv4_address() {
        assert!(validate_ipv4_address("10.0.0.1").is_ok());
        assert!(validate_ipv4_address("192.168.1.1").is_ok());
        assert!(validate_ipv4_address("255.255.255.255").is_ok());

        assert!(validate_ipv4_address("256.0.0.1").is_err());
        assert!(validate_ipv4_address("not.an.ip").is_err());
        assert!(validate_ipv4_address("").is_err());
    }

    #[test]
    fn test_validate_subnet() {
        assert!(validate_subnet(0).is_ok());
        assert!(validate_subnet(24).is_ok());
        assert!(validate_subnet(32).is_ok());

        assert!(validate_subnet(33).is_err());
        assert!(validate_subnet(255).is_err());
    }

    #[test]
    fn test_tun_config_default() {
        let config = TunConfig::default();
        assert_eq!(config.name, "jeju0");
        assert_eq!(config.mtu, TUNNEL_MTU);
        assert_eq!(config.address, Ipv4Addr::new(10, 0, 0, 2));
    }
}
