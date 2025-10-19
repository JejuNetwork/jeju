use crate::backend::{BackendError, BackendResult};
use std::future::Future;
use std::time::Duration;
use tokio::time::sleep;
use tracing::{debug, info, warn};

/// Configuration for retry behavior
#[derive(Debug, Clone)]
pub struct RetryConfig {
    /// Maximum number of retry attempts
    pub max_attempts: u32,
    /// Initial delay between retries
    pub initial_delay: Duration,
    /// Factor to multiply delay by after each attempt
    pub backoff_factor: f64,
    /// Maximum delay between retries
    pub max_delay: Duration,
    /// Whether to use jitter to randomize delays
    pub jitter: bool,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 5,
            initial_delay: Duration::from_secs(1),
            backoff_factor: 2.0,
            max_delay: Duration::from_secs(30),
            jitter: true,
        }
    }
}

impl RetryConfig {
    /// Create a configuration for quick retries (e.g., health checks)
    pub fn quick() -> Self {
        Self {
            max_attempts: 10,
            initial_delay: Duration::from_millis(500),
            backoff_factor: 1.5,
            max_delay: Duration::from_secs(5),
            jitter: true,
        }
    }

    /// Create a configuration for slow operations (e.g., container startup)
    #[allow(dead_code)]
    pub fn slow() -> Self {
        Self {
            max_attempts: 3,
            initial_delay: Duration::from_secs(2),
            backoff_factor: 2.0,
            max_delay: Duration::from_secs(20),
            jitter: false,
        }
    }

    /// Create a configuration for Podman connection recovery
    pub fn podman_recovery() -> Self {
        Self {
            max_attempts: 5,
            initial_delay: Duration::from_secs(3),
            backoff_factor: 1.5,
            max_delay: Duration::from_secs(15),
            jitter: true,
        }
    }
}

/// Retry a future with exponential backoff
pub async fn retry_with_backoff<F, Fut, T>(
    operation_name: &str,
    config: RetryConfig,
    mut operation: F,
) -> BackendResult<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = BackendResult<T>>,
{
    let mut attempt = 0;
    let mut delay = config.initial_delay;

    loop {
        attempt += 1;
        debug!(
            "Attempting {} (attempt {}/{})",
            operation_name, attempt, config.max_attempts
        );

        match operation().await {
            Ok(result) => {
                if attempt > 1 {
                    info!("✅ {} succeeded after {} attempts", operation_name, attempt);
                }
                return Ok(result);
            }
            Err(e) if attempt >= config.max_attempts => {
                warn!(
                    "❌ {} failed after {} attempts: {}",
                    operation_name, attempt, e
                );
                return Err(e);
            }
            Err(e) => {
                warn!(
                    "⚠️ {} failed (attempt {}/{}): {}",
                    operation_name, attempt, config.max_attempts, e
                );

                // Apply jitter if enabled
                let mut actual_delay = delay;
                if config.jitter {
                    use rand::Rng;
                    let jitter_factor = rand::thread_rng().gen_range(0.8..1.2);
                    actual_delay = Duration::from_secs_f64(delay.as_secs_f64() * jitter_factor);
                }

                info!("⏳ Retrying {} in {:?}...", operation_name, actual_delay);
                sleep(actual_delay).await;

                // Calculate next delay with backoff
                delay = Duration::from_secs_f64(
                    (delay.as_secs_f64() * config.backoff_factor)
                        .min(config.max_delay.as_secs_f64()),
                );
            }
        }
    }
}

/// Check if an error is retryable
pub fn is_retryable_error(error: &BackendError) -> bool {
    let error_str = error.to_string().to_lowercase();

    // Connection errors are retryable
    if error_str.contains("connection refused")
        || error_str.contains("connection reset")
        || error_str.contains("unable to connect")
        || error_str.contains("socket")
        || error_str.contains("timeout")
        || error_str.contains("temporarily unavailable")
    {
        return true;
    }

    // Podman-specific retryable errors
    if error_str.contains("podman machine")
        || error_str.contains("podman socket")
        || error_str.contains("cannot connect to podman")
        || error_str.contains("dial tcp")
        || error_str.contains("dial unix")
    {
        return true;
    }

    // Container state errors that might be temporary
    if error_str.contains("container is starting")
        || error_str.contains("container is restarting")
        || error_str.contains("is not running")
    {
        return true;
    }

    false
}

/// Retry only if the error is retryable
#[allow(dead_code)]
pub async fn retry_if_retryable<F, Fut, T>(
    operation_name: &str,
    config: RetryConfig,
    operation: F,
) -> BackendResult<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = BackendResult<T>>,
{
    retry_with_backoff(operation_name, config, operation).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_retry_config_defaults() {
        let config = RetryConfig::default();
        assert_eq!(config.max_attempts, 5);
        assert_eq!(config.initial_delay, Duration::from_secs(1));
    }

    #[test]
    fn test_is_retryable_error() {
        let error = BackendError::Container("Connection refused".to_string());
        assert!(is_retryable_error(&error));

        let error = BackendError::Container("Cannot connect to Podman".to_string());
        assert!(is_retryable_error(&error));

        let error = BackendError::Container("Invalid configuration".to_string());
        assert!(!is_retryable_error(&error));
    }
}
