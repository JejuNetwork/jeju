use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    // Set build timestamp as environment variable for compile time
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards")
        .as_secs();

    println!("cargo:rustc-env=BUILD_TIMESTAMP={}", timestamp);

    // Re-run build script on any source change to update timestamp
    println!("cargo:rerun-if-changed=src/");

    // Run tauri build script
    tauri_build::build()
}
