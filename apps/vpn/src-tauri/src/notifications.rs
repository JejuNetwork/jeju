//! Notification system for Jeju VPN
//!
//! Provides desktop notifications for connection events.

use notify_rust::{Notification, Timeout};

/// Notification type
#[derive(Debug, Clone, Copy)]
pub enum NotificationType {
    Connected,
    Disconnected,
    ConnectionFailed,
    Reconnecting,
    EarningsUpdate,
    ContributionStarted,
    ContributionStopped,
}

/// Notification manager
pub struct NotificationManager {
    enabled: bool,
    app_name: String,
}

impl NotificationManager {
    pub fn new() -> Self {
        Self {
            enabled: true,
            app_name: "Jeju VPN".to_string(),
        }
    }

    /// Enable or disable notifications
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    /// Show a notification
    pub fn notify(&self, notification_type: NotificationType, details: Option<&str>) {
        if !self.enabled {
            return;
        }

        let (title, body, icon) = match notification_type {
            NotificationType::Connected => (
                "VPN Connected",
                details.unwrap_or("Your connection is now protected"),
                "network-vpn",
            ),
            NotificationType::Disconnected => (
                "VPN Disconnected",
                details.unwrap_or("Your connection is no longer protected"),
                "network-offline",
            ),
            NotificationType::ConnectionFailed => (
                "Connection Failed",
                details.unwrap_or("Failed to connect to VPN node"),
                "network-error",
            ),
            NotificationType::Reconnecting => (
                "Reconnecting...",
                details.unwrap_or("Connection lost, attempting to reconnect"),
                "network-wireless-acquiring",
            ),
            NotificationType::EarningsUpdate => (
                "Earnings Update",
                details.unwrap_or("You've earned tokens for sharing bandwidth"),
                "emblem-money",
            ),
            NotificationType::ContributionStarted => (
                "Sharing Started",
                details.unwrap_or("You're now contributing to the network"),
                "emblem-shared",
            ),
            NotificationType::ContributionStopped => (
                "Sharing Stopped",
                details.unwrap_or("You've stopped contributing to the network"),
                "emblem-unreadable",
            ),
        };

        self.show(title, body, icon);
    }

    /// Show a custom notification
    fn show(&self, title: &str, body: &str, icon: &str) {
        let result = Notification::new()
            .summary(title)
            .body(body)
            .icon(icon)
            .appname(&self.app_name)
            .timeout(Timeout::Milliseconds(5000))
            .show();

        if let Err(e) = result {
            tracing::warn!("Failed to show notification: {}", e);
        }
    }

    /// Show connection notification with location
    pub fn notify_connected(&self, country: &str, location: &str) {
        let body = format!("Connected to {} ({})", location, country);
        self.notify(NotificationType::Connected, Some(&body));
    }

    /// Show earnings notification
    pub fn notify_earnings(&self, amount: f64, token: &str) {
        let body = format!("You earned {:.4} {} for sharing bandwidth", amount, token);
        self.notify(NotificationType::EarningsUpdate, Some(&body));
    }
}

impl Default for NotificationManager {
    fn default() -> Self {
        Self::new()
    }
}

