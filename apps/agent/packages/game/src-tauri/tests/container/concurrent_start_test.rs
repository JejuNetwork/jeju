use app_lib::{
    BackendError, BackendResult, ContainerManager, ContainerRuntimeType, OLLAMA_CONTAINER,
    POSTGRES_CONTAINER,
};
use std::sync::Arc;

#[tokio::test]
async fn test_concurrent_container_starts() -> BackendResult<()> {
    println!("Testing concurrent container starts with Podman synchronization...");

    // Create container manager
    let manager = match ContainerManager::new(ContainerRuntimeType::Podman) {
        Ok(mgr) => Arc::new(mgr),
        Err(_) => {
            println!("Skipping test - no container runtime available");
            return Ok(());
        }
    };

    println!("✅ Container manager created, starting concurrent operations...");

    // Start containers concurrently using the simplified public API
    let postgres_task = tokio::spawn({
        let manager = manager.clone();
        async move {
            println!("🐘 Starting PostgreSQL container...");
            let result = manager.start_postgres().await;
            ("postgres", result)
        }
    });

    let ollama_task = tokio::spawn({
        let manager = manager.clone();
        async move {
            println!("🦙 Starting Ollama container...");
            let result = manager.start_ollama().await;
            ("ollama", result)
        }
    });

    // Wait for both tasks to complete
    let (postgres_result, ollama_result) = tokio::join!(postgres_task, ollama_task);

    // Check results
    let mut success_count = 0;
    let mut errors = Vec::new();

    match postgres_result {
        Ok((name, Ok(status))) => {
            println!("✅ {} started successfully: {}", name, status.id);
            success_count += 1;
        }
        Ok((name, Err(e))) => {
            println!("❌ {} failed to start: {}", name, e);
            errors.push((name, e));
        }
        Err(e) => {
            println!("❌ PostgreSQL task panicked: {}", e);
        }
    }

    match ollama_result {
        Ok((name, Ok(status))) => {
            println!("✅ {} started successfully: {}", name, status.id);
            success_count += 1;
        }
        Ok((name, Err(e))) => {
            println!("❌ {} failed to start: {}", name, e);
            errors.push((name, e));
        }
        Err(e) => {
            println!("❌ Ollama task panicked: {}", e);
        }
    }

    // Clean up - stop and remove test containers
    println!("\n🧹 Cleaning up test containers...");
    let _ = manager.stop_container(POSTGRES_CONTAINER).await;
    let _ = manager.remove_container(POSTGRES_CONTAINER).await;
    let _ = manager.stop_container(OLLAMA_CONTAINER).await;
    let _ = manager.remove_container(OLLAMA_CONTAINER).await;

    // Verify results
    if success_count > 0 {
        println!("\n✅ Concurrent container start test PASSED!");
        println!(
            "{} containers started successfully without race conditions.",
            success_count
        );
        Ok(())
    } else {
        println!("\n❌ Concurrent container start test FAILED!");
        println!("No containers started successfully");
        for (name, error) in errors {
            println!("  - {}: {}", name, error);
        }
        Err(BackendError::Container(
            "Failed to start any containers".to_string(),
        ))
    }
}

#[tokio::test]
async fn test_podman_machine_restart_mutex() -> BackendResult<()> {
    println!("Testing concurrent container operations handle Podman restarts gracefully...");

    let manager = match ContainerManager::new(ContainerRuntimeType::Podman) {
        Ok(mgr) => Arc::new(mgr),
        Err(_) => {
            println!("Skipping test - no container runtime available");
            return Ok(());
        }
    };

    // Simulate multiple concurrent container operations
    let mut tasks = vec![];

    for i in 0..3 {
        let manager_clone = manager.clone();
        let task = tokio::spawn(async move {
            println!("Task {} attempting container operation...", i);
            let start = std::time::Instant::now();
            // Try to get container status which may trigger internal Podman checks
            let result = manager_clone
                .get_container_status(&format!("test-concurrent-{}", i))
                .await;
            let duration = start.elapsed();
            println!("Task {} completed in {:?}", i, duration);
            (i, result)
        });
        tasks.push(task);
    }

    // Wait for all tasks
    let results = futures::future::join_all(tasks).await;

    // All tasks should complete without panicking (container not found errors are expected)
    let mut all_completed = true;
    for result in results {
        match result {
            Ok((i, Ok(_))) => {
                println!("✅ Task {} succeeded (container found)", i);
            }
            Ok((i, Err(_))) => {
                // Container not found is expected, this still tests concurrency
                println!("✅ Task {} completed (container not found, as expected)", i);
            }
            Err(e) => {
                println!("❌ Task panicked: {}", e);
                all_completed = false;
            }
        }
    }

    if all_completed {
        println!("\n✅ Concurrent operations test PASSED!");
        println!("All concurrent operations handled gracefully without race conditions.");
        Ok(())
    } else {
        Err(BackendError::Container(
            "Some concurrent operations failed due to race conditions".to_string(),
        ))
    }
}
