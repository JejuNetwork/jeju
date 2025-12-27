# Jeju Name Service Browser Extension

Browser extension for resolving `.jeju` domains via the decentralized Jeju Name Service (JNS).

## Features

- **Automatic .jeju domain resolution** - Navigate to .jeju domains like `dws.jeju` or `app.jeju`
- **Local DWS node support** - Prefer your local DWS node for resolution when available
- **IPFS content delivery** - Serve content from IPFS via contenthash records
- **Worker endpoint support** - Route dynamic requests to DWS worker endpoints
- **Quick lookup** - Manually resolve any .jeju domain from the popup
- **Caching** - Cache resolutions for faster subsequent requests
- **Visual indicator** - Shows when you're viewing a JNS-resolved page

## Installation

### From Source (Development)

1. Clone the repository
2. Navigate to `apps/browser-extension`
3. Open Chrome and go to `chrome://extensions`
4. Enable "Developer mode" (top right toggle)
5. Click "Load unpacked" and select this directory

### Chrome Web Store

Coming soon.

## Usage

### Automatic Resolution

Once installed, simply navigate to any `.jeju` domain:
- `http://dws.jeju`
- `https://myapp.jeju`

The extension will:
1. Intercept the navigation
2. Resolve the domain via JNS (local DWS node or public gateway)
3. Redirect to the content (IPFS gateway or worker endpoint)

### Popup Features

Click the extension icon to:
- Toggle JNS resolution on/off
- Configure gateway URLs
- Perform quick domain lookups
- Clear the resolution cache

### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Enable JNS Resolution | Master toggle for the extension | On |
| Prefer Local Node | Use local DWS node first | On |
| Local DWS URL | URL of your local DWS node | `http://localhost:4030` |
| Public Gateway URL | Fallback JNS gateway | `https://gateway.jejunetwork.org` |
| IPFS Gateway URL | Gateway for serving IPFS content | `https://ipfs.jejunetwork.org` |

## How It Works

1. **Domain Detection**: The extension monitors navigation to `.jeju` domains
2. **Resolution**: Queries the JNS resolver at `/dns/jns/{domain}`
3. **Content Location**: Determines the content source:
   - Worker endpoint (for dynamic apps)
   - IPFS hash (from contenthash record)
   - Gateway proxy (fallback)
4. **Redirect**: Sends the browser to the resolved content

## JNS Record Types

The extension supports these JNS record types:

| Record | Description |
|--------|-------------|
| `contenthash` | EIP-1577 encoded IPFS CID |
| `address` | Ethereum address (owner) |
| `text.dws.worker` | DWS worker endpoint URL |
| Custom text records | Any text record stored on-chain |

## Permissions

The extension requires these permissions:
- `storage` - Save settings and cache
- `webNavigation` - Intercept .jeju domain navigation
- `webRequest` - Handle requests to .jeju domains
- `declarativeNetRequest` - Rule-based request handling
- `tabs` - Update tab URLs for redirection
- `activeTab` - Access current tab information

## Development

```bash
# Install dependencies
bun install

# Generate icons (requires sharp)
bun run build:icons

# Build for distribution
bun run build
```

## Troubleshooting

### Domain not resolving

1. Check if JNS resolution is enabled in the popup
2. Verify the domain exists by looking it up in the popup
3. Check if your local DWS node is running (if "Prefer Local" is on)
4. Try clearing the cache

### "Resolution Failed" error page

The domain may not be registered on JNS, or all gateways are unreachable.
Check gateway connectivity in the popup.

## License

MIT
