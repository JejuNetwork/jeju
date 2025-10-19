/**
 * Authentication Panel Component for ElizaOS Client GUI
 * Provides visual interface for API key management and status
 */

import React, { useState, useEffect } from 'react';
import type { AuthStatus, ApiKeyValidationResult } from './AuthenticationService';

export interface AuthenticationPanelProps {
  runtime?: any; // IAgentRuntime type
  onAuthChange?: (status: AuthStatus) => void;
}

interface ProviderCardProps {
  provider: string;
  result: ApiKeyValidationResult;
  onTest: (provider: string) => void;
  onValidate: (provider: string, key: string) => void;
  testing: boolean;
}

/**
 * Individual Provider Status Card
 */
const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  result,
  onTest,
  onValidate,
  testing,
}) => {
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [apiKey, setApiKey] = useState('');

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'openai':
        return '🤖';
      case 'groq':
        return '⚡';
      case 'anthropic':
        return '🧠';
      default:
        return '🔧';
    }
  };

  const getStatusBadge = (result: ApiKeyValidationResult) => {
    if (result.isValid) {
      const typeColor =
        result.keyType === 'test' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800';
      const typeText =
        result.keyType === 'test' ? 'TEST' : result.keyType === 'production' ? 'PROD' : 'VALID';
      return (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${typeColor}`}>
          {typeText}
        </span>
      );
    } else {
      return (
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
          INVALID
        </span>
      );
    }
  };

  const handleValidate = () => {
    if (apiKey.trim()) {
      onValidate(provider, apiKey.trim());
      setApiKey('');
      setShowKeyInput(false);
    }
  };

  return (
    <div
      className={`border rounded-lg p-4 ${result.isValid ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <span className="text-2xl">{getProviderIcon(provider)}</span>
          <h3 className="text-lg font-semibold capitalize">{provider}</h3>
        </div>
        {getStatusBadge(result)}
      </div>

      <div className="space-y-2 text-sm">
        <div>
          <span className="font-medium">Capabilities: </span>
          {result.capabilities.length > 0 ? (
            <span className="text-blue-600">{result.capabilities.join(', ')}</span>
          ) : (
            <span className="text-gray-500">None</span>
          )}
        </div>

        {result.errorMessage && (
          <div className="text-red-600">
            <span className="font-medium">Error: </span>
            {result.errorMessage}
          </div>
        )}

        {result.rateLimits && (
          <div className="text-blue-600">
            <span className="font-medium">Rate Limits: </span>
            {result.rateLimits.remaining} remaining
          </div>
        )}

        {result.usage && (
          <div className="text-gray-600">
            <span className="font-medium">Usage: </span>
            {result.usage.tokensUsed} tokens, ${result.usage.costEstimate.toFixed(4)}
          </div>
        )}
      </div>

      <div className="mt-4 flex space-x-2">
        <button
          onClick={() => onTest(provider)}
          disabled={testing || !result.isValid}
          className={`px-3 py-1 text-xs rounded ${
            result.isValid && !testing
              ? 'bg-blue-500 text-white hover:bg-blue-600'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {testing ? 'Testing...' : 'Test API'}
        </button>

        <button
          onClick={() => setShowKeyInput(!showKeyInput)}
          className="px-3 py-1 text-xs rounded bg-gray-500 text-white hover:bg-gray-600"
        >
          Validate Key
        </button>
      </div>

      {showKeyInput && (
        <div className="mt-3 space-y-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={`Enter ${provider} API key...`}
            className="w-full px-3 py-2 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <div className="flex space-x-2">
            <button
              onClick={handleValidate}
              className="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
            >
              Validate
            </button>
            <button
              onClick={() => {
                setShowKeyInput(false);
                setApiKey('');
              }}
              className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Main Authentication Panel Component
 */
export const AuthenticationPanel: React.FC<AuthenticationPanelProps> = ({
  runtime,
  onAuthChange,
}) => {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mock implementation for demonstration
  // In real implementation, this would connect to AuthenticationService
  const mockAuthStatus: AuthStatus = {
    overall: 'healthy',
    providers: {
      openai: {
        isValid: true,
        provider: 'openai',
        keyType: 'production',
        capabilities: ['text_generation', 'embeddings', 'image_description'],
        usage: { tokensUsed: 1250, costEstimate: 0.025 },
      },
      groq: {
        isValid: true,
        provider: 'groq',
        keyType: 'test',
        capabilities: ['text_generation'],
      },
      anthropic: {
        isValid: false,
        provider: 'anthropic',
        keyType: 'invalid',
        capabilities: [],
        errorMessage: 'API key not configured',
      },
    },
    lastChecked: new Date(),
    capabilities: ['text_generation', 'embeddings', 'image_description'],
  };

  useEffect(() => {
    loadAuthStatus();
  }, []);

  const loadAuthStatus = async () => {
    setLoading(true);
    setError(null);

    try {
      // In real implementation, use AuthenticationService
      // const authService = new AuthenticationService(runtime);
      // const status = await authService.getAuthStatus();

      // For now, use mock data
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate API call
      const status = mockAuthStatus;

      setAuthStatus(status);
      onAuthChange?.(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load auth status');
    } finally {
      setLoading(false);
    }
  };

  const handleTestProvider = async (provider: string) => {
    if (!runtime) {
      return;
    }

    setTesting(provider);
    try {
      // In real implementation:
      // const authService = new AuthenticationService(runtime);
      // const result = await authService.testApiFunctionality(provider);

      // Mock implementation
      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log(`Testing ${provider} API functionality...`);

      // Refresh status after test
      await loadAuthStatus();
    } catch (err) {
      setError(
        `Test failed for ${provider}: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    } finally {
      setTesting(null);
    }
  };

  const handleValidateKey = async (provider: string, apiKey: string) => {
    if (!runtime) {
      return;
    }

    try {
      // In real implementation:
      // const authService = new AuthenticationService(runtime);
      // const result = await authService.validateApiKey(provider, apiKey);

      // Mock implementation
      console.log(`Validating ${provider} API key:`, `${apiKey.substring(0, 10)}...`);

      // Refresh status after validation
      await loadAuthStatus();
    } catch (err) {
      setError(
        `Validation failed for ${provider}: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  };

  const getOverallStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return { icon: '✅', color: 'text-green-600', bg: 'bg-green-100' };
      case 'degraded':
        return { icon: '⚠️', color: 'text-yellow-600', bg: 'bg-yellow-100' };
      case 'failed':
        return { icon: '❌', color: 'text-red-600', bg: 'bg-red-100' };
      default:
        return { icon: '❓', color: 'text-gray-600', bg: 'bg-gray-100' };
    }
  };

  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <div className="flex items-center justify-center space-x-2">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
          <span>Loading authentication status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <div className="text-red-600">
          <h3 className="text-lg font-semibold mb-2">Authentication Error</h3>
          <p>{error}</p>
          <button
            onClick={loadAuthStatus}
            className="mt-3 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!authStatus) {
    return null;
  }

  const statusDisplay = getOverallStatusIcon(authStatus.overall);

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">API Authentication</h2>
        <button
          onClick={loadAuthStatus}
          className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
        >
          Refresh
        </button>
      </div>

      {/* Overall Status */}
      <div className={`p-4 rounded-lg mb-6 ${statusDisplay.bg}`}>
        <div className="flex items-center space-x-3">
          <span className="text-2xl">{statusDisplay.icon}</span>
          <div>
            <h3 className={`text-lg font-semibold ${statusDisplay.color}`}>
              System Status: {authStatus.overall.toUpperCase()}
            </h3>
            <p className="text-sm text-gray-600">
              Last checked: {authStatus.lastChecked.toLocaleString()}
            </p>
            <p className="text-sm text-gray-600">
              Available capabilities: {authStatus.capabilities.join(', ')}
            </p>
          </div>
        </div>
      </div>

      {/* Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(authStatus.providers).map(([provider, result]) => (
          <ProviderCard
            key={provider}
            provider={provider}
            result={result}
            onTest={handleTestProvider}
            onValidate={handleValidateKey}
            testing={testing === provider}
          />
        ))}
      </div>

      {/* Help Section */}
      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
        <h4 className="font-semibold text-blue-800 mb-2">Need Help?</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• OpenAI: Required for embeddings and vision features</li>
          <li>• Groq: Optional for fast text generation</li>
          <li>• Anthropic: Optional for Claude model access</li>
          <li>
            • Use CLI: <code className="bg-blue-100 px-1 rounded">elizaos auth:setup</code> for
            guided setup
          </li>
        </ul>
      </div>
    </div>
  );
};

export default AuthenticationPanel;
