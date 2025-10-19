import React, { useState, useEffect } from 'react';

interface ModelInfo {
  name: string;
  description: string;
  min_memory_gb: number;
  recommended: boolean;
  installed: boolean;
}

interface OllamaRecommendations {
  success: boolean;
  system_info: {
    total_memory_gb: number;
    total_memory_mb: number;
    recommended_memory_mb: number;
    has_sufficient_memory: boolean;
  };
  recommended_models: ModelInfo[];
  all_models: ModelInfo[];
  default_model: string;
  installed_models: string[];
}

interface OllamaModelSelectorProps {
  value: string;
  onChange: (model: string) => void;
}

export const OllamaModelSelector: React.FC<OllamaModelSelectorProps> = ({ value, onChange }) => {
  const [recommendations, setRecommendations] = useState<OllamaRecommendations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const fetchRecommendations = async () => {
    try {
      setLoading(true);
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<OllamaRecommendations>('get_ollama_recommendations');

      if (result.success) {
        setRecommendations(result);
        // If no value set, use the default model
        if (!value && result.default_model) {
          onChange(result.default_model);
        }
      } else {
        setError('Failed to get model recommendations');
      }
    } catch (err) {
      console.error('Failed to fetch Ollama recommendations:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="ollama-model-selector">
        <label>Model</label>
        <div className="loading-message">Loading model recommendations...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ollama-model-selector">
        <label>Model</label>
        <input
          type="text"
          className="config-input"
          value={value || 'llama3.2:3b'}
          placeholder="llama3.2:3b"
          onChange={(e) => onChange(e.target.value)}
          data-testid="ollama-model-input"
        />
        <small style={{ color: '#ff4444', fontSize: '10px', marginTop: '4px' }}>
          Error loading recommendations: {error}
        </small>
      </div>
    );
  }

  if (!recommendations) {
    return null;
  }

  const { system_info, recommended_models, all_models } = recommendations;

  return (
    <div className="ollama-model-selector">
      <div className="system-info-banner">
        <div className="system-memory">
          <span className="memory-icon">💾</span>
          <span className="memory-value">{system_info.total_memory_gb.toFixed(1)} GB RAM</span>
        </div>
        {!system_info.has_sufficient_memory && (
          <div className="memory-warning">
            ⚠️ Limited memory detected. Smaller models recommended.
          </div>
        )}
      </div>

      <label>Model</label>
      <select
        className="config-select model-select"
        value={value || recommendations.default_model}
        onChange={(e) => onChange(e.target.value)}
        data-testid="ollama-model-select"
      >
        {recommended_models.length > 0 && (
          <optgroup label="✨ Recommended for your system">
            {recommended_models.map((model) => (
              <option key={model.name} value={model.name}>
                {model.name} - {model.description}
                {model.installed && ' ✓'}
              </option>
            ))}
          </optgroup>
        )}

        {all_models.filter((m) => !m.recommended).length > 0 && (
          <optgroup label="⚡ Other models (may require more memory)">
            {all_models
              .filter((m) => !m.recommended)
              .map((model) => (
                <option key={model.name} value={model.name}>
                  {model.name} - {model.description} (needs {model.min_memory_gb}GB)
                  {model.installed && ' ✓'}
                </option>
              ))}
          </optgroup>
        )}
      </select>

      <div className="model-info">
        {all_models.find((m) => m.name === (value || recommendations.default_model)) && (
          <>
            <small className="model-requirements">
              Selected model requires at least{' '}
              {
                all_models.find((m) => m.name === (value || recommendations.default_model))
                  ?.min_memory_gb
              }
              GB RAM
            </small>
            {recommendations.installed_models.includes(value || recommendations.default_model) && (
              <small className="model-installed">✓ Model is installed</small>
            )}
          </>
        )}
      </div>

      <style>{`
        .ollama-model-selector {
          margin-bottom: 16px;
        }

        .system-info-banner {
          background: rgba(0, 50, 0, 0.4);
          border: 1px solid rgba(0, 255, 0, 0.3);
          border-radius: 4px;
          padding: 8px;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 8px;
        }

        .system-memory {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #00ff00;
          font-size: 12px;
          font-weight: bold;
        }

        .memory-icon {
          font-size: 16px;
        }

        .memory-warning {
          color: #ffaa00;
          font-size: 11px;
        }

        .loading-message {
          color: #888;
          font-size: 12px;
          padding: 8px;
          text-align: center;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
        }

        .model-select {
          width: 100%;
          margin-top: 4px;
        }

        .model-info {
          margin-top: 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .model-requirements {
          color: #888;
          font-size: 10px;
        }

        .model-installed {
          color: #00ff00;
          font-size: 10px;
          font-weight: bold;
        }

        label {
          display: block;
          color: #00ff00;
          font-size: 12px;
          text-transform: uppercase;
          margin-bottom: 4px;
        }

        select {
          background: #0a0a0a;
          border: 1px solid #333;
          color: #fff;
          padding: 8px;
          border-radius: 4px;
          font-family: monospace;
          font-size: 12px;
        }

        select:focus {
          outline: none;
          border-color: #00ff00;
        }

        optgroup {
          color: #00ff00;
          font-weight: bold;
        }

        option {
          color: #fff;
          background: #1a1a1a;
          font-weight: normal;
          padding: 4px;
        }

        option:hover {
          background: #2a2a2a;
        }

        .config-input {
          width: 100%;
          background: #0a0a0a;
          border: 1px solid #333;
          color: #fff;
          padding: 8px;
          border-radius: 4px;
          font-family: monospace;
          font-size: 12px;
          margin-top: 4px;
        }

        .config-input:focus {
          outline: none;
          border-color: #00ff00;
        }
      `}</style>
    </div>
  );
};
