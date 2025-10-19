/**
 * API configuration for direct backend connections
 * This replaces the Vite proxy setup for better Tauri compatibility
 */

// Determine the backend URL based on environment
const getBackendUrl = (): string => {
  // Get backend port from environment variables (with fallback to 7777)
  const getBackendPort = () => {
    // Check multiple environment variable names
    return (
      import.meta.env.REACT_APP_SERVER_PORT ||
      import.meta.env.REACT_APP_BACKEND_PORT ||
      import.meta.env.VITE_REACT_APP_SERVER_PORT ||
      import.meta.env.VITE_REACT_APP_BACKEND_PORT ||
      '7777'
    );
  };

  const backendPort = getBackendPort();

  // Check if we're in a browser environment
  if (typeof window !== 'undefined') {
    // In Tauri, we always connect directly to the backend
    if ((window as any).__TAURI__) {
      return `http://localhost:${backendPort}`;
    }

    // In development (Vite dev server), connect directly to the backend
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return `http://localhost:${backendPort}`;
    }

    // In production, use the same origin (backend serves the frontend)
    return window.location.origin;
  }

  // In Node.js environment, connect directly to the backend server
  return `http://localhost:${backendPort}`;
};

export const BACKEND_URL = getBackendUrl();

/**
 * Helper function to construct API URLs
 * @param path - API path (e.g., '/api/setup/status')
 * @returns Full URL for the API endpoint
 */
export const apiUrl = (path: string): string => {
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${BACKEND_URL}${normalizedPath}`;
};

/**
 * Fetch wrapper with proper error handling and default options
 */
export const apiFetch = async (path: string, options: RequestInit = {}): Promise<Response> => {
  const url = apiUrl(path);

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  return response;
};
