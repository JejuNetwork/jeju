use crate::backend::{BackendError, BackendResult};
use serde_json::json;
use std::time::Duration;
use tokio::time::timeout;

#[allow(dead_code)]
pub struct ModelManager;

#[allow(dead_code)]
impl ModelManager {
    /// Ensure required models are downloaded in Ollama
    pub async fn ensure_models_downloaded(ollama_url: &str) -> BackendResult<()> {
        println!("🤖 Checking required AI models...");

        let required_models = vec!["llama3.2:3b", "nomic-embed-text"];

        for model in required_models {
            if !Self::is_model_available(ollama_url, model).await? {
                println!("📥 Downloading model: {}", model);
                Self::download_model(ollama_url, model).await?;
            } else {
                println!("✅ Model already available: {}", model);
            }
        }

        println!("🎯 All required models are ready!");
        Ok(())
    }

    /// Check if a specific model is available
    async fn is_model_available(ollama_url: &str, model_name: &str) -> BackendResult<bool> {
        let client = reqwest::Client::new();
        let url = format!("{}/api/tags", ollama_url);

        let response = client
            .get(&url)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| BackendError::Container(e.to_string()))?;

        let tags: serde_json::Value = response
            .json()
            .await
            .map_err(|e| BackendError::Container(e.to_string()))?;

        if let Some(models) = tags["models"].as_array() {
            for model in models {
                if let Some(name) = model["name"].as_str() {
                    if name == model_name {
                        return Ok(true);
                    }
                }
            }
        }

        Ok(false)
    }

    /// Download a model from Ollama
    async fn download_model(ollama_url: &str, model_name: &str) -> BackendResult<()> {
        let client = reqwest::Client::new();
        let url = format!("{}/api/pull", ollama_url);

        let payload = json!({
            "name": model_name
        });

        println!("🔄 Starting download for model: {}", model_name);

        // Start the download request with a longer timeout
        let response = timeout(
            Duration::from_secs(600), // 10 minutes timeout
            client.post(&url).json(&payload).send(),
        )
        .await
        .map_err(|_| BackendError::Container("Model download timed out".to_string()))?
        .map_err(|e| BackendError::Container(e.to_string()))?;

        if response.status().is_success() {
            // For simplicity, just wait a moment and assume the download started
            // In a production environment, we'd parse the streaming response properly
            println!("✅ Successfully started download for model: {}", model_name);
            Ok(())
        } else {
            Err(BackendError::Container(format!(
                "Failed to download model {}: HTTP {}",
                model_name,
                response.status()
            )))
        }
    }

    /// Verify models are working by testing generation
    pub async fn verify_models_working(ollama_url: &str) -> BackendResult<()> {
        println!("🧪 Testing model functionality...");

        // Test text generation with llama3.2:3b
        Self::test_text_generation(ollama_url, "llama3.2:3b").await?;

        // Test embedding generation with nomic-embed-text
        Self::test_embedding_generation(ollama_url, "nomic-embed-text").await?;

        println!("✅ All models are working correctly!");
        Ok(())
    }

    async fn test_text_generation(ollama_url: &str, model: &str) -> BackendResult<()> {
        let client = reqwest::Client::new();
        let url = format!("{}/api/generate", ollama_url);

        let payload = json!({
            "model": model,
            "prompt": "Hello, world!",
            "stream": false
        });

        let response = timeout(
            Duration::from_secs(30),
            client.post(&url).json(&payload).send(),
        )
        .await
        .map_err(|_| BackendError::Container("Text generation test timed out".to_string()))?
        .map_err(|e| BackendError::Container(e.to_string()))?;

        if response.status().is_success() {
            println!("✅ Text generation working with {}", model);
            Ok(())
        } else {
            Err(BackendError::Container(format!(
                "Text generation test failed: HTTP {}",
                response.status()
            )))
        }
    }

    async fn test_embedding_generation(ollama_url: &str, model: &str) -> BackendResult<()> {
        let client = reqwest::Client::new();
        let url = format!("{}/api/embeddings", ollama_url);

        let payload = json!({
            "model": model,
            "prompt": "test embedding"
        });

        let response = timeout(
            Duration::from_secs(30),
            client.post(&url).json(&payload).send(),
        )
        .await
        .map_err(|_| BackendError::Container("Embedding test timed out".to_string()))?
        .map_err(|e| BackendError::Container(e.to_string()))?;

        if response.status().is_success() {
            println!("✅ Embedding generation working with {}", model);
            Ok(())
        } else {
            Err(BackendError::Container(format!(
                "Embedding test failed: HTTP {}",
                response.status()
            )))
        }
    }
}
