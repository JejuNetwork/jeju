# Mac App Store Deployment Configuration

This directory contains all Mac App Store-specific deployment files and scripts.

## Prerequisites

1. **Apple Developer Account** ($99/year):

   - Enroll at https://developer.apple.com
   - Access to App Store Connect

2. **Certificates & Provisioning**:

   - Mac App Distribution certificate
   - Mac Installer Distribution certificate
   - App Store provisioning profile
   - Developer ID certificates (for notarization)

3. **Xcode** (latest version):
   - Required for code signing and notarization
   - App Store Connect integration

## Setup Instructions

1. **Configure Signing**:

   ```bash
   # Set your Apple Developer credentials
   export APPLE_ID="your@email.com"
   export APPLE_TEAM_ID="XXXXXXXXXX"
   export APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # App-specific password
   ```

2. **Build for App Store**:

   ```bash
   ./scripts/build_mas.sh
   ```

3. **Validate Package**:

   ```bash
   ./scripts/validate_mas.sh
   ```

4. **Upload to App Store Connect**:
   ```bash
   ./scripts/upload_mas.sh
   ```

## Directory Structure

```
mac-app-store/
├── README.md (this file)
├── Info.plist
├── entitlements-mas.plist
├── embedded.provisionprofile
├── scripts/
│   ├── build_mas.sh
│   ├── validate_mas.sh
│   └── upload_mas.sh
└── assets/
    ├── AppIcon.appiconset/
    └── screenshots/
```

## Entitlements

The Mac App Store requires specific entitlements for sandboxed apps:

```xml
<key>com.apple.security.app-sandbox</key>
<true/>
<key>com.apple.security.network.client</key>
<true/>
<key>com.apple.security.files.user-selected.read-write</key>
<true/>
```

## App Store Assets

| Asset         | Requirements                        |
| ------------- | ----------------------------------- |
| App Icon      | 1024x1024 PNG without alpha         |
| Screenshots   | 2880x1800 (5K), 2560x1600, 1440x900 |
| Preview Video | Optional, up to 30 seconds          |

## Submission Checklist

- [ ] App runs in sandbox environment
- [ ] No private APIs used
- [ ] Proper code signing with App Store certificates
- [ ] Valid provisioning profile
- [ ] App Store Connect metadata complete
- [ ] Screenshots for all required sizes
- [ ] App description and keywords
- [ ] Privacy policy URL
- [ ] Support URL
- [ ] Copyright information

## Common Issues

1. **Sandbox Violations**:

   - Remove any file system access outside sandbox
   - Use security-scoped bookmarks for user files

2. **Private API Usage**:

   - Tauri's updater must be disabled for App Store
   - No JIT compilation or dynamic code loading

3. **Notarization vs App Store**:
   - App Store apps don't need separate notarization
   - Use App Store certificates, not Developer ID

## Testing

1. **Local Testing**:

   ```bash
   # Install and run the .app bundle
   open "build/ELIZA.app"
   ```

2. **TestFlight**:

   - Upload to App Store Connect
   - Distribute via TestFlight for beta testing

3. **Validation**:
   ```bash
   xcrun altool --validate-app -f "build/ELIZA.pkg" -t macos -u $APPLE_ID -p $APPLE_APP_PASSWORD
   ```
