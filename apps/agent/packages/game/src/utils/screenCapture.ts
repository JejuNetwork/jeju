/**
 * Screen capture utilities for browser-based screen sharing
 */

export interface ScreenCaptureCapabilities {
  available: boolean;
  displayMedia: boolean;
  getUserMedia: boolean;
  error?: string;
}

/**
 * Check if screen capture APIs are available
 */
export function checkScreenCaptureCapabilities(): ScreenCaptureCapabilities {
  const capabilities: ScreenCaptureCapabilities = {
    available: false,
    displayMedia: false,
    getUserMedia: false,
  };

  try {
    // Check for navigator.mediaDevices
    if (!navigator.mediaDevices) {
      capabilities.error = 'navigator.mediaDevices not available';
      return capabilities;
    }

    // Check for getDisplayMedia (screen capture)
    if ('getDisplayMedia' in navigator.mediaDevices) {
      capabilities.displayMedia = true;
    } else {
      capabilities.error = 'getDisplayMedia not supported';
    }

    // Check for getUserMedia (camera/mic)
    if ('getUserMedia' in navigator.mediaDevices) {
      capabilities.getUserMedia = true;
    }

    capabilities.available = capabilities.displayMedia;
  } catch (error) {
    capabilities.error = `Error checking capabilities: ${error}`;
  }

  return capabilities;
}

/**
 * Test screen capture functionality
 */
export async function testScreenCapture(): Promise<boolean> {
  const capabilities = checkScreenCaptureCapabilities();

  if (!capabilities.displayMedia) {
    console.error('Screen capture not available:', capabilities.error);
    return false;
  }

  try {
    // Try to get a stream (user will need to approve)
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 1, max: 1 } }, // Low frame rate for test
      audio: false,
    });

    // Success - stop the stream immediately
    stream.getTracks().forEach((track) => track.stop());
    console.log('✅ Screen capture test successful');
    return true;
  } catch (error: any) {
    if (error.name === 'NotAllowedError') {
      console.log('ℹ️ Screen capture test cancelled by user');
      return true; // API is available, user just cancelled
    }
    console.error('❌ Screen capture test failed:', error);
    return false;
  }
}

/**
 * Get user-friendly error message for screen capture errors
 */
export function getScreenCaptureErrorMessage(error: any): string {
  if (error.name === 'NotAllowedError') {
    return 'Screen sharing permission denied. Please allow access and try again.';
  }
  if (error.name === 'NotFoundError') {
    return 'No screen sources available for sharing.';
  }
  if (error.name === 'NotReadableError') {
    return 'Screen source is currently unavailable. It may be in use by another application.';
  }
  if (error.name === 'OverconstrainedError') {
    return 'Screen sharing constraints cannot be satisfied.';
  }
  if (error.name === 'TypeError') {
    return 'Invalid screen sharing configuration.';
  }
  return `Screen sharing error: ${error.message || error.name || 'Unknown error'}`;
}
