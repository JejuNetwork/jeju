# Linux App Store Deployment

This directory contains configurations for deploying ElizaOS to various Linux app stores and package managers.

## Supported Platforms

### 1. Snap Store (Ubuntu)

- **Directory**: `snap/`
- **File**: `snapcraft.yaml`
- **Documentation**: [Snapcraft Docs](https://snapcraft.io/docs)

### 2. Flathub (Flatpak)

- **Directory**: `flatpak/`
- **File**: `com.elizaos.Game.yml`
- **Documentation**: [Flatpak Docs](https://docs.flatpak.org)

## Quick Start

### Snap Store

```bash
# Install snapcraft
sudo snap install snapcraft --classic

# Build snap package
cd snap
snapcraft

# Test locally
sudo snap install *.snap --dangerous

# Upload to store (requires login)
snapcraft login
snapcraft upload --release=stable *.snap
```

### Flathub

```bash
# Install flatpak-builder
sudo apt install flatpak-builder

# Build flatpak
cd flatpak
flatpak-builder --repo=repo build-dir com.elizaos.Game.yml

# Test locally
flatpak-builder --user --install --force-clean build-dir com.elizaos.Game.yml
flatpak run com.elizaos.Game

# Create bundle for distribution
flatpak build-bundle repo elizaos.flatpak com.elizaos.Game
```

## Publishing Process

### Snap Store

1. Create Ubuntu One account at https://snapcraft.io
2. Register snap name: `snapcraft register elizaos`
3. Build and test snap locally
4. Upload: `snapcraft upload --release=stable elizaos_*.snap`
5. View in store: https://snapcraft.io/elizaos

### Flathub

1. Fork https://github.com/flathub/flathub
2. Create new branch: `new-app-com.elizaos.Game`
3. Add manifest and required files
4. Submit pull request
5. Respond to reviewer feedback
6. Once merged, app appears on Flathub

## Desktop Integration

Both platforms require:

- `.desktop` file for application launcher
- Icon in multiple sizes
- AppStream metadata (`.metainfo.xml`)

## Architecture Support

- **Snap**: Supports amd64, arm64, armhf
- **Flatpak**: Supports x86_64, aarch64

## Confinement/Sandboxing

### Snap Confinement Levels

- `strict`: Full sandboxing (recommended)
- `classic`: No sandboxing (requires manual review)
- `devmode`: For development only

### Flatpak Permissions

Configured in `finish-args`:

- Network access
- Home directory access
- Graphics/audio access
- D-Bus communication

## Debugging

### Snap

```bash
# Run with debugging
snap run --shell elizaos
# Check interfaces
snap connections elizaos
# View logs
journalctl -u snap.elizaos.*
```

### Flatpak

```bash
# Run with debugging
flatpak run --command=sh com.elizaos.Game
# Check permissions
flatpak info --show-permissions com.elizaos.Game
# View logs
journalctl -f
```

## Common Issues

1. **WebKit not loading**: Ensure webkit2gtk is properly bundled
2. **Network access denied**: Check sandbox permissions
3. **Graphics issues**: May need to disable compositing
4. **File access**: Use portals for file dialogs

## Testing Checklist

- [ ] Application launches successfully
- [ ] Network requests work (AI APIs)
- [ ] File save/load dialogs function
- [ ] Graphics render correctly
- [ ] Audio works (if applicable)
- [ ] Desktop integration (menu, icon)
- [ ] Auto-updates work (snap only)

## Resources

- [Snapcraft Forum](https://forum.snapcraft.io/)
- [Flatpak Matrix](https://matrix.to/#/#flatpak:matrix.org)
- [Desktop Entry Spec](https://specifications.freedesktop.org/desktop-entry-spec/latest/)
- [AppStream Spec](https://www.freedesktop.org/software/appstream/docs/)
