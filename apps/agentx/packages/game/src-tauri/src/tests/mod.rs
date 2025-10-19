pub mod media_streaming_tests;
pub mod runtime_tests;
pub mod screen_sharing_tests;
pub mod shutdown_test;

use crate::startup::StartupStatus;
use tauri::{AppHandle, Emitter};
use tracing::{error, info};

// Common constants available for tests if needed
// pub use crate::common::{AGENT_CONTAINER, NETWORK_NAME, OLLAMA_CONTAINER, POSTGRES_CONTAINER};

pub async fn run_all_tests(app_handle: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    info!("🧪 Starting comprehensive runtime test suite...");

    // Update startup status
    app_handle.emit(
        "startup-status",
        StartupStatus {
            stage: crate::startup::StartupStage::RunningTests,
            message: "Running integration tests...".to_string(),
            progress: 90,
            details: "Testing all IPC endpoints and media streaming".to_string(),
            can_retry: false,
            runtime_status: None,
            container_statuses: std::collections::HashMap::new(),
            game_api_ready: true, // Tests run after Game API is verified
        },
    )?;

    // Run all test suites
    let mut all_results = Vec::new();

    // Run endpoint tests
    let endpoint_results = runtime_tests::run_all_endpoint_tests(&app_handle).await;
    all_results.extend(endpoint_results);

    // Run media streaming tests
    match media_streaming_tests::test_media_streaming(app_handle.clone()).await {
        Ok(_) => {
            all_results.push(Ok("Media streaming tests passed".to_string()));
        }
        Err(e) => {
            // The test returned an error string, wrap it in a Box
            all_results.push(Err(e.into()));
        }
    }

    // Run screen sharing tests
    match screen_sharing_tests::test_screen_sharing(app_handle.clone()).await {
        Ok(_) => {
            all_results.push(Ok("Screen sharing tests passed".to_string()));
        }
        Err(e) => {
            all_results.push(Err(e.into()));
        }
    }

    // Report results
    let (passed, failed): (Vec<_>, Vec<_>) = all_results
        .iter()
        .enumerate()
        .partition(|(_, result)| result.is_ok());

    info!(
        "✅ Test Suite Complete: {} passed, {} failed",
        passed.len(),
        failed.len()
    );

    if !failed.is_empty() {
        error!("❌ {} tests failed:", failed.len());
        for (index, _) in &failed {
            if let Err(e) = &all_results[*index] {
                error!("  - Test {}: {}", index + 1, e);
            }
        }

        // Emit failure status
        app_handle.emit(
            "startup-status",
            StartupStatus {
                stage: crate::startup::StartupStage::RunningTests,
                message: format!("Runtime tests failed: {} tests failed", failed.len()),
                progress: 90,
                details: "Critical test failures detected. App will exit.".to_string(),
                can_retry: false,
                runtime_status: None,
                container_statuses: std::collections::HashMap::new(),
                game_api_ready: true,
            },
        )?;

        // Exit with failure code
        error!("💥 Exiting due to test failures. Fix the issues and restart.");
        std::process::exit(1);
    }

    info!("🎉 All tests passed!");
    Ok(())
}
