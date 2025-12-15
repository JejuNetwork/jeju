import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'network.jeju.wallet',
  appName: 'Network Wallet',
  webDir: 'dist',
  
  // Server configuration for live reload during development
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    // Uncomment for live reload during development:
    // url: 'http://YOUR_LOCAL_IP:4015',
    // cleartext: true,
  },

  // iOS-specific configuration
  ios: {
    contentInset: 'automatic',
    scheme: 'Network Wallet',
    backgroundColor: '#0a0a0a',
    preferredContentMode: 'mobile',
    // Universal links
    appendedURLScheme: 'jeju',
    allowsLinkPreview: true,
  },

  // Android-specific configuration
  android: {
    backgroundColor: '#0a0a0a',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false, // Set to true for debug builds
    // Deep links
    appendedURLScheme: 'jeju',
  },

  // Plugin configuration
  plugins: {
    // Splash screen configuration
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0a0a0a',
      androidSplashResourceName: 'splash',
      iosSplashResourceName: 'Default',
      showSpinner: false,
    },
    
    // Status bar configuration
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#0a0a0a',
    },
    
    // Keyboard configuration
    Keyboard: {
      resize: 'body',
      style: 'dark',
      resizeOnFullScreen: true,
    },
    
    // Push notifications (for transaction alerts)
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    
    // App URL handlers for deep links
    App: {
      launchAutoHide: true,
    },
    
    // Browser plugin for external purchases (IAP compliance)
    Browser: {
      presentationStyle: 'fullscreen',
    },
    
    // Preferences for local storage
    Preferences: {
      group: 'JejuWallet',
    },
    
    // Biometric authentication
    BiometricAuth: {
      allowDeviceCredential: true,
    },
  },

  // Cordova configuration (for plugins that still use Cordova)
  cordova: {},
};

export default config;

