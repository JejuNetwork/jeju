# Microsoft Store MSIX Build Script for ElizaOS
# Requires Windows SDK and Developer Mode enabled

param(
    [string]$Configuration = "Release",
    [string]$Architecture = "x64",
    [switch]$SkipBuild = $false
)

$ErrorActionPreference = "Stop"

Write-Host "📦 Building ElizaOS for Microsoft Store..." -ForegroundColor Cyan

# Check prerequisites
if (-not $env:MS_PACKAGE_NAME) {
    Write-Host "❌ Error: MS_PACKAGE_NAME not set" -ForegroundColor Red
    Write-Host "Set it with: `$env:MS_PACKAGE_NAME = 'YourPublisher.ElizaOS'" -ForegroundColor Yellow
    exit 1
}

if (-not $env:MS_PUBLISHER) {
    Write-Host "❌ Error: MS_PUBLISHER not set" -ForegroundColor Red
    Write-Host "Set it with: `$env:MS_PUBLISHER = 'CN=YourName'" -ForegroundColor Yellow
    exit 1
}

# Get paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$MSStoreDir = Split-Path -Parent $ScriptDir
$DeploymentDir = Split-Path -Parent $MSStoreDir
$ProjectRoot = Split-Path -Parent $DeploymentDir
$GameDir = Join-Path $ProjectRoot "packages\game"
$OutputDir = Join-Path $MSStoreDir "output"

# Create output directory
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# Build Tauri app if not skipped
if (-not $SkipBuild) {
    Write-Host "🔨 Building Tauri application..." -ForegroundColor Green
    Push-Location $GameDir
    try {
        npm run build
    } finally {
        Pop-Location
    }
}

# Get version from package.json
$PackageJson = Get-Content (Join-Path $GameDir "package.json") | ConvertFrom-Json
$Version = $PackageJson.version + ".0"  # MSIX requires 4-part version

Write-Host "📋 Creating MSIX package structure..." -ForegroundColor Green

# Create temporary directory for MSIX contents
$TempDir = Join-Path $env:TEMP "elizaos_msix_$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

# Copy application files
$AppDir = Join-Path $TempDir "app"
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

# Find and copy the built executable
$ExePath = Join-Path $GameDir "src-tauri\target\release\elizaos.exe"
if (Test-Path $ExePath) {
    Copy-Item $ExePath -Destination (Join-Path $AppDir "ElizaOS.exe")
} else {
    Write-Host "❌ Error: Built executable not found at $ExePath" -ForegroundColor Red
    exit 1
}

# Copy resources
$ResourcesSource = Join-Path $GameDir "dist"
if (Test-Path $ResourcesSource) {
    $ResourcesDest = Join-Path $AppDir "resources"
    Copy-Item -Path $ResourcesSource -Destination $ResourcesDest -Recurse
}

# Copy Visual C++ Redistributables if present
$VCRedistPath = Join-Path $GameDir "src-tauri\target\release\bundle\windows\vc_redist"
if (Test-Path $VCRedistPath) {
    Copy-Item -Path $VCRedistPath -Destination $AppDir -Recurse
}

# Generate AppxManifest.xml
Write-Host "📝 Generating AppxManifest.xml..." -ForegroundColor Green

$ManifestContent = @"
<?xml version="1.0" encoding="utf-8"?>
<Package 
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:mp="http://schemas.microsoft.com/appx/2014/phone/manifest"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap mp rescap">

  <Identity
    Name="$($env:MS_PACKAGE_NAME)"
    Publisher="$($env:MS_PUBLISHER)"
    Version="$Version"
    ProcessorArchitecture="$Architecture" />

  <Properties>
    <DisplayName>ELIZA</DisplayName>
    <PublisherDisplayName>$($env:MS_PUBLISHER_DISPLAY -replace '"', '')</PublisherDisplayName>
    <Logo>assets\StoreLogo.png</Logo>
  </Properties>

  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.22621.0" />
  </Dependencies>

  <Resources>
    <Resource Language="en-US" />
  </Resources>

  <Applications>
    <Application Id="ElizaOS" Executable="app\ElizaOS.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="ELIZA"
        Description="Autonomous AI agent life simulation game"
        BackgroundColor="transparent"
        Square150x150Logo="assets\Square150x150Logo.png"
        Square44x44Logo="assets\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="assets\Wide310x150Logo.png" />
        <uap:SplashScreen Image="assets\SplashScreen.png" />
      </uap:VisualElements>
    </Application>
  </Applications>

  <Capabilities>
    <Capability Name="internetClient" />
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@

$ManifestPath = Join-Path $TempDir "AppxManifest.xml"
$ManifestContent | Out-File -FilePath $ManifestPath -Encoding UTF8

# Copy assets
Write-Host "🎨 Copying assets..." -ForegroundColor Green
$AssetsSource = Join-Path $MSStoreDir "assets"
$AssetsDest = Join-Path $TempDir "assets"

if (Test-Path $AssetsSource) {
    Copy-Item -Path $AssetsSource -Destination $TempDir -Recurse
} else {
    # Create placeholder assets if not present
    New-Item -ItemType Directory -Force -Path $AssetsDest | Out-Null
    Write-Host "⚠️  Warning: Assets directory not found. Using placeholders." -ForegroundColor Yellow
    
    # Create placeholder images (you should replace these with actual assets)
    Add-Type -AssemblyName System.Drawing
    
    $sizes = @{
        "Square150x150Logo.png" = @(150, 150)
        "Square44x44Logo.png" = @(44, 44)
        "Wide310x150Logo.png" = @(310, 150)
        "StoreLogo.png" = @(50, 50)
        "SplashScreen.png" = @(620, 300)
    }
    
    foreach ($file in $sizes.Keys) {
        $width = $sizes[$file][0]
        $height = $sizes[$file][1]
        $bitmap = New-Object System.Drawing.Bitmap $width, $height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.Clear([System.Drawing.Color]::FromArgb(30, 30, 30))
        $font = New-Object System.Drawing.Font("Arial", 12)
        $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $graphics.DrawString("ELIZA", $font, $brush, 10, 10)
        $bitmap.Save((Join-Path $AssetsDest $file))
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

# Create resources.pri
Write-Host "🔧 Creating resources.pri..." -ForegroundColor Green
$PriConfigPath = Join-Path $TempDir "priconfig.xml"

@"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<resources targetOsVersion="10.0.0" majorVersion="1">
  <index root="\" startIndexAt="\">
    <default>
      <qualifier name="Language" value="en-US"/>
      <qualifier name="Scale" value="100"/>
    </default>
    <indexer-config type="folder" foldernameAsQualifier="false" filenameAsQualifier="true" qualifierDelimiter="."/>
  </index>
</resources>
"@ | Out-File -FilePath $PriConfigPath -Encoding UTF8

# Run makepri.exe
$MakePriPath = "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.22621.0\x64\makepri.exe"
if (-not (Test-Path $MakePriPath)) {
    # Try to find makepri.exe in other SDK versions
    $SdkPath = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    $MakePriPath = Get-ChildItem -Path $SdkPath -Filter "makepri.exe" -Recurse | 
                   Where-Object { $_.FullName -like "*x64*" } | 
                   Select-Object -First 1 -ExpandProperty FullName
}

if (Test-Path $MakePriPath) {
    Push-Location $TempDir
    try {
        & $MakePriPath createconfig /cf priconfig.xml /dq en-US
        & $MakePriPath new /pr . /cf priconfig.xml /of resources.pri
    } finally {
        Pop-Location
    }
} else {
    Write-Host "⚠️  Warning: makepri.exe not found. Package may not work correctly." -ForegroundColor Yellow
}

# Package the app
Write-Host "📦 Creating MSIX package..." -ForegroundColor Green
$MsixPath = Join-Path $OutputDir "ElizaOS_${Version}_${Architecture}.msix"

$MakeAppxPath = "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.22621.0\x64\makeappx.exe"
if (-not (Test-Path $MakeAppxPath)) {
    # Try to find makeappx.exe in other SDK versions
    $SdkPath = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    $MakeAppxPath = Get-ChildItem -Path $SdkPath -Filter "makeappx.exe" -Recurse | 
                    Where-Object { $_.FullName -like "*x64*" } | 
                    Select-Object -First 1 -ExpandProperty FullName
}

if (Test-Path $MakeAppxPath) {
    & $MakeAppxPath pack /d $TempDir /p $MsixPath /o
} else {
    Write-Host "❌ Error: makeappx.exe not found. Please install Windows SDK." -ForegroundColor Red
    exit 1
}

# Sign the package (if certificate is available)
if ($env:MS_CERTIFICATE_PATH -and $env:MS_CERTIFICATE_PASSWORD) {
    Write-Host "🔐 Signing MSIX package..." -ForegroundColor Green
    
    $SignToolPath = "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe"
    if (-not (Test-Path $SignToolPath)) {
        $SdkPath = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
        $SignToolPath = Get-ChildItem -Path $SdkPath -Filter "signtool.exe" -Recurse | 
                        Where-Object { $_.FullName -like "*x64*" } | 
                        Select-Object -First 1 -ExpandProperty FullName
    }
    
    if (Test-Path $SignToolPath) {
        & $SignToolPath sign /fd SHA256 /a /f $env:MS_CERTIFICATE_PATH /p $env:MS_CERTIFICATE_PASSWORD $MsixPath
    }
} else {
    Write-Host "⚠️  Warning: Package not signed. Set MS_CERTIFICATE_PATH and MS_CERTIFICATE_PASSWORD to sign." -ForegroundColor Yellow
}

# Clean up
Write-Host "🧹 Cleaning up temporary files..." -ForegroundColor Green
Remove-Item -Path $TempDir -Recurse -Force

Write-Host "✅ MSIX package created successfully!" -ForegroundColor Green
Write-Host "📦 Package location: $MsixPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Test the package: .\scripts\test_msix.ps1"
Write-Host "2. Run certification: .\scripts\certify_msix.ps1"
Write-Host "3. Upload to Partner Center: .\scripts\upload_msix.ps1"