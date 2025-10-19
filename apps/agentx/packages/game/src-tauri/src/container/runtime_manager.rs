use crate::backend::{BackendError, BackendResult};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use tracing::{debug, error, info, warn};

#[derive(Debug, Clone)]
pub struct RuntimeManager {
    resource_dir: PathBuf,
    bundled_runtime_path: Option<PathBuf>,
    system_runtime_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub enum RuntimeType {
    Bundled(PathBuf),
    System(PathBuf),
    Downloaded(PathBuf),
}

impl RuntimeManager {
    pub fn new(resource_dir: PathBuf) -> Self {
        Self {
            resource_dir,
            bundled_runtime_path: None,
            system_runtime_path: None,
        }
    }

    /// Initialize and detect available container runtimes with proper caching and fallbacks
    pub async fn initialize(&mut self) -> BackendResult<RuntimeType> {
        info!("🔍 Initializing container runtime manager");

        // Step 1: Check for cached/bundled runtime first (highest priority)
        if let Some(bundled_path) = self.detect_bundled_runtime() {
            if self.verify_runtime(&bundled_path).await.is_ok() {
                info!(
                    "✅ Using cached/bundled container runtime: {:?}",
                    bundled_path
                );
                self.bundled_runtime_path = Some(bundled_path.clone());
                return Ok(RuntimeType::Bundled(bundled_path));
            }
            warn!("⚠️  Bundled runtime exists but failed verification, will try alternatives");
        } else {
            info!("ℹ️  No bundled runtime found");
        }

        // Step 2: Check for system runtime (Podman first, then Docker)
        info!("🔍 Checking for system container runtimes...");

        // Try Podman first (preferred)
        if let Some(podman_path) = self.find_system_executable("podman").await {
            if self.verify_runtime(&podman_path).await.is_ok() {
                info!("✅ Using system Podman: {:?}", podman_path);
                self.system_runtime_path = Some(podman_path.clone());
                return Ok(RuntimeType::System(podman_path));
            }
            warn!("⚠️  System Podman found but failed verification");
        }

        // Try Docker only if Podman is not available
        if let Some(docker_path) = self.find_system_executable("docker").await {
            if self.verify_runtime(&docker_path).await.is_ok() {
                info!(
                    "✅ Using system Docker (Podman not available): {:?}",
                    docker_path
                );
                self.system_runtime_path = Some(docker_path.clone());
                return Ok(RuntimeType::System(docker_path));
            }
            warn!("⚠️  System Docker found but failed verification");
        }

        info!("ℹ️  No system container runtime available");

        // Step 3: Auto-install Podman only if neither Docker nor Podman is available
        let bundled_executable =
            self.resource_dir
                .join("bin")
                .join(if cfg!(target_os = "windows") {
                    "podman.exe"
                } else {
                    "podman"
                });

        if bundled_executable.exists() {
            warn!("⚠️  Bundled runtime exists but verification failed, not re-downloading");
            return Err(BackendError::Container(
                "Bundled runtime exists but is not functional".to_string(),
            ));
        }

        // Step 4: Download and cache runtime for future use
        info!("📥 No container runtime available, downloading and caching...");
        match self.download_and_install_runtime().await {
            Ok(downloaded_path) => {
                info!(
                    "✅ Successfully downloaded and cached container runtime: {:?}",
                    downloaded_path
                );
                self.bundled_runtime_path = Some(downloaded_path.clone());
                Ok(RuntimeType::Downloaded(downloaded_path))
            }
            Err(e) => {
                error!("❌ Failed to download container runtime: {}", e);
                Err(BackendError::Container(format!(
                    "No container runtime available and download failed: {e}"
                )))
            }
        }
    }

    /// Detect bundled container runtime
    fn detect_bundled_runtime(&self) -> Option<PathBuf> {
        let bin_dir = self.resource_dir.join("bin");
        let executable_name = if cfg!(target_os = "windows") {
            "podman.exe"
        } else {
            "podman"
        };

        let bundled_path = bin_dir.join(executable_name);

        if bundled_path.exists() && bundled_path.is_file() {
            // Verify it's executable
            #[cfg(unix)]
            {
                if let Ok(metadata) = bundled_path.metadata() {
                    let permissions = metadata.permissions();
                    if permissions.mode() & 0o111 != 0 {
                        return Some(bundled_path);
                    }
                    warn!(
                        "Bundled runtime exists but is not executable: {:?}",
                        bundled_path
                    );
                }
            }

            #[cfg(target_os = "windows")]
            {
                return Some(bundled_path);
            }
        }

        None
    }

    /// Find system executable in PATH
    async fn find_system_executable(&self, name: &str) -> Option<PathBuf> {
        match Command::new("which").arg(name).output() {
            Ok(output) if output.status.success() => {
                let path_output = String::from_utf8_lossy(&output.stdout);
                let path_str = path_output.trim();
                if !path_str.is_empty() {
                    return Some(PathBuf::from(path_str));
                }
            }
            _ => {}
        }

        // Windows fallback
        #[cfg(target_os = "windows")]
        {
            match Command::new("where").arg(name).output() {
                Ok(output) if output.status.success() => {
                    let path_str = String::from_utf8_lossy(&output.stdout).trim();
                    if !path_str.is_empty() {
                        return Some(PathBuf::from(path_str.lines().next().unwrap_or("")));
                    }
                }
                _ => {}
            }
        }

        None
    }

    /// Verify that a runtime path is functional
    async fn verify_runtime(&self, runtime_path: &Path) -> BackendResult<()> {
        debug!("Verifying container runtime: {:?}", runtime_path);

        match Command::new(runtime_path).arg("--version").output() {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout);
                info!("Container runtime verified: {}", version.trim());
                Ok(())
            }
            Ok(output) => {
                let error = String::from_utf8_lossy(&output.stderr);
                Err(BackendError::Container(format!(
                    "Runtime verification failed: {error}"
                )))
            }
            Err(e) => Err(BackendError::Container(format!(
                "Failed to execute runtime: {e}"
            ))),
        }
    }

    /// Download and install container runtime
    async fn download_and_install_runtime(&self) -> BackendResult<PathBuf> {
        info!(
            "Downloading container runtime for platform: {}-{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        );

        let platform_key = Self::get_platform_key();
        let download_info = Self::get_download_info(&platform_key)?;

        // Create download directory
        let download_dir = self.resource_dir.join("download");
        fs::create_dir_all(&download_dir)
            .map_err(|e| BackendError::Container(format!("Failed to create download dir: {e}")))?;

        // Download the archive
        let archive_path = download_dir.join(&download_info.filename);
        self.download_file(&download_info.url, &archive_path)
            .await?;

        // Extract the archive
        let extract_dir = download_dir.join("extract");
        fs::create_dir_all(&extract_dir)
            .map_err(|e| BackendError::Container(format!("Failed to create extract dir: {e}")))?;

        self.extract_archive(&archive_path, &extract_dir).await?;

        // Find and install the executable
        let executable_path =
            Self::find_executable_in_extract(&extract_dir, &download_info.executable_pattern)?;
        let install_path = self.install_executable(&executable_path).await?;

        // Cleanup
        let _ = fs::remove_dir_all(&download_dir);

        Ok(install_path)
    }

    /// Get platform-specific download information
    fn get_download_info(platform_key: &str) -> BackendResult<DownloadInfo> {
        match platform_key {
            "darwin-x64" => Ok(DownloadInfo {
                url: "https://github.com/containers/podman/releases/download/v4.8.3/podman-remote-release-darwin_amd64.zip".to_string(),
                filename: "podman-remote-release-darwin_amd64.zip".to_string(),
                executable_pattern: "podman-remote-release-darwin_amd64/bin/podman-remote".to_string(),
            }),
            "darwin-arm64" => Ok(DownloadInfo {
                url: "https://github.com/containers/podman/releases/download/v4.8.3/podman-remote-release-darwin_arm64.zip".to_string(),
                filename: "podman-remote-release-darwin_arm64.zip".to_string(),
                executable_pattern: "podman-remote-release-darwin_arm64/bin/podman-remote".to_string(),
            }),
            "linux-x64" => Ok(DownloadInfo {
                url: "https://github.com/containers/podman/releases/download/v4.8.3/podman-remote-static-linux_amd64.tar.gz".to_string(),
                filename: "podman-remote-static-linux_amd64.tar.gz".to_string(),
                executable_pattern: "podman-remote-static".to_string(),
            }),
            "windows-x64" => Ok(DownloadInfo {
                url: "https://github.com/containers/podman/releases/download/v4.8.3/podman-remote-release-windows_amd64.zip".to_string(),
                filename: "podman-remote-release-windows_amd64.zip".to_string(),
                executable_pattern: "podman-remote-release-windows_amd64/usr/bin/podman.exe".to_string(),
            }),
            _ => Err(BackendError::Container(format!("Unsupported platform: {platform_key}"))),
        }
    }

    /// Get platform key for current system
    fn get_platform_key() -> String {
        let os = std::env::consts::OS;
        let arch = match std::env::consts::ARCH {
            "x86_64" => "x64",
            "aarch64" => "arm64",
            other => other,
        };

        match os {
            "macos" => format!("darwin-{arch}"),
            "windows" => format!("windows-{arch}"),
            "linux" => format!("linux-{arch}"),
            other => format!("{other}-{arch}"),
        }
    }

    /// Download a file from URL
    async fn download_file(&self, url: &str, output_path: &Path) -> BackendResult<()> {
        info!("Downloading: {} -> {:?}", url, output_path);

        let client = reqwest::Client::new();
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| BackendError::Container(format!("Download request failed: {e}")))?;

        if !response.status().is_success() {
            return Err(BackendError::Container(format!(
                "Download failed with status: {}",
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| BackendError::Container(format!("Failed to read response: {e}")))?;

        fs::write(output_path, bytes)
            .map_err(|e| BackendError::Container(format!("Failed to write file: {e}")))?;

        info!("Download completed: {:?}", output_path);
        Ok(())
    }

    /// Extract archive (supports .zip and .tar.gz)
    async fn extract_archive(&self, archive_path: &Path, extract_dir: &Path) -> BackendResult<()> {
        info!("Extracting: {:?} -> {:?}", archive_path, extract_dir);

        let extension = archive_path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("");

        match extension {
            "zip" => Self::extract_zip(archive_path, extract_dir),
            "gz" => Self::extract_tar_gz(archive_path, extract_dir),
            _ => Err(BackendError::Container(format!(
                "Unsupported archive format: {extension}"
            ))),
        }
    }

    /// Extract ZIP archive
    fn extract_zip(archive_path: &Path, extract_dir: &Path) -> BackendResult<()> {
        #[cfg(unix)]
        {
            let output = Command::new("unzip")
                .arg("-q")
                .arg(archive_path)
                .arg("-d")
                .arg(extract_dir)
                .output()
                .map_err(|e| BackendError::Container(format!("Failed to run unzip: {e}")))?;

            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                return Err(BackendError::Container(format!("Unzip failed: {error}")));
            }
        }

        #[cfg(target_os = "windows")]
        {
            // Use PowerShell on Windows
            let output = Command::new("powershell")
                .arg("-Command")
                .arg(format!(
                    "Expand-Archive -Path '{}' -DestinationPath '{}'",
                    archive_path.display(),
                    extract_dir.display()
                ))
                .output()
                .map_err(|e| BackendError::Container(format!("Failed to run PowerShell: {}", e)))?;

            if !output.status.success() {
                let error = String::from_utf8_lossy(&output.stderr);
                return Err(BackendError::Container(format!(
                    "PowerShell extract failed: {}",
                    error
                )));
            }
        }

        Ok(())
    }

    /// Extract tar.gz archive
    fn extract_tar_gz(archive_path: &Path, extract_dir: &Path) -> BackendResult<()> {
        let output = Command::new("tar")
            .arg("-xzf")
            .arg(archive_path)
            .arg("-C")
            .arg(extract_dir)
            .output()
            .map_err(|e| BackendError::Container(format!("Failed to run tar: {e}")))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(BackendError::Container(format!(
                "Tar extract failed: {error}"
            )));
        }

        Ok(())
    }

    /// Find executable in extracted directory
    fn find_executable_in_extract(extract_dir: &Path, pattern: &str) -> BackendResult<PathBuf> {
        let executable_path = extract_dir.join(pattern);

        if executable_path.exists() {
            return Ok(executable_path);
        }

        // If direct pattern doesn't work, search recursively
        for entry in walkdir::WalkDir::new(extract_dir).into_iter().flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name() {
                if name == "podman" || name == "podman.exe" || name == "podman-remote" {
                    return Ok(path.to_path_buf());
                }
            }
        }

        Err(BackendError::Container(format!(
            "Executable not found in extract directory: {pattern}"
        )))
    }

    /// Install executable to final location
    async fn install_executable(&self, source_path: &Path) -> BackendResult<PathBuf> {
        let bin_dir = self.resource_dir.join("bin");
        fs::create_dir_all(&bin_dir)
            .map_err(|e| BackendError::Container(format!("Failed to create bin dir: {e}")))?;

        let executable_name = if cfg!(target_os = "windows") {
            "podman.exe"
        } else {
            "podman"
        };

        let install_path = bin_dir.join(executable_name);

        // Copy the executable
        fs::copy(source_path, &install_path)
            .map_err(|e| BackendError::Container(format!("Failed to copy executable: {e}")))?;

        // Make executable on Unix systems
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&install_path)
                .map_err(|e| BackendError::Container(format!("Failed to get file metadata: {e}")))?
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&install_path, permissions)
                .map_err(|e| BackendError::Container(format!("Failed to set permissions: {e}")))?;
        }

        info!("Container runtime installed: {:?}", install_path);
        Ok(install_path)
    }
}

#[derive(Debug)]
struct DownloadInfo {
    url: String,
    filename: String,
    executable_pattern: String,
}
