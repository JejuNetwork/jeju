# Microsoft Store Deployment Configuration

This directory contains all Microsoft Store-specific deployment files and scripts.

## Prerequisites

1. **Windows Developer Account**:

   - Register at https://partner.microsoft.com/dashboard
   - Individual: $19 (one-time)
   - Company: $99 (one-time)

2. **Windows SDK**:

   - Download from https://developer.microsoft.com/windows/downloads/windows-sdk/
   - Required for MSIX packaging

3. **Visual Studio 2022** (optional but recommended):
   - For advanced MSIX editing
   - Windows Application Packaging Project

## Setup Instructions

1. **Configure Package Identity**:

   ```powershell
   # Set your package identity
   $env:MS_PACKAGE_NAME = "YourPublisher.ElizaOS"
   $env:MS_PUBLISHER = "CN=YourName"
   $env:MS_PUBLISHER_DISPLAY = "Your Company Name"
   ```

2. **Generate MSIX Package**:

   ```powershell
   .\scripts\build_msix.ps1
   ```

3. **Test Package**:

   ```powershell
   .\scripts\test_msix.ps1
   ```

4. **Upload to Store**:
   ```powershell
   .\scripts\upload_msix.ps1
   ```

## Directory Structure

```
microsoft-store/
├── README.md (this file)
├── AppxManifest.xml
├── scripts/
│   ├── build_msix.ps1
│   ├── test_msix.ps1
│   └── upload_msix.ps1
├── assets/
│   ├── Square150x150Logo.png
│   ├── Square44x44Logo.png
│   ├── Wide310x150Logo.png
│   └── StoreLogo.png
└── priconfig.xml
```

## Asset Requirements

| Asset                 | Size    | Usage         |
| --------------------- | ------- | ------------- |
| Square150x150Logo.png | 150x150 | Medium tile   |
| Square44x44Logo.png   | 44x44   | App list      |
| Wide310x150Logo.png   | 310x150 | Wide tile     |
| StoreLogo.png         | 50x50   | Store listing |
| SplashScreen.png      | 620x300 | Splash screen |

## Testing

Use the Windows App Certification Kit (WACK):

```powershell
# Run certification test
& "${env:ProgramFiles(x86)}\Windows Kits\10\App Certification Kit\appcert.exe" test -appxpackagepath ".\output\ElizaOS.msix" -reportoutputpath ".\certification_report.xml"
```

## Submission Process

1. **Package Creation**: Build and sign MSIX
2. **Local Testing**: Install and test locally
3. **Certification**: Run WACK tests
4. **Store Submission**: Upload via Partner Center
5. **Review**: Microsoft review (2-7 days)
6. **Release**: Publish to Store
