# Steam Deployment Configuration

This directory contains all Steam-specific deployment files and scripts.

## Setup Instructions

1. **Get your Steam App ID**:

   - Register at https://partner.steamgames.com
   - Create a new app and note your App ID

2. **Download Steamworks SDK**:

   - Download from https://partner.steamgames.com/downloads/
   - Extract to `steam/sdk/`

3. **Configure Environment**:

   ```bash
   export STEAM_USERNAME="your_username"
   export STEAM_PASSWORD="your_password"
   export STEAM_APP_ID="your_app_id"
   ```

4. **Build and Upload**:
   ```bash
   ./scripts/build_steam.sh
   ./scripts/upload_steam.sh
   ```

## Directory Structure

```
steam/
├── README.md (this file)
├── steam_appid.txt
├── sdk/ (Steamworks SDK - not committed)
├── scripts/
│   ├── build_steam.sh
│   └── upload_steam.sh
├── vdf/
│   ├── app_build_[appid].vdf
│   └── depot_build_[appid].vdf
└── assets/
    ├── capsule_main.png (616x353)
    ├── header.jpg (460x215)
    ├── library_hero.png (1920x620)
    └── screenshots/
```

## Asset Requirements

See `assets/README.md` for detailed asset specifications.
