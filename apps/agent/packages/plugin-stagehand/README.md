# Stagehand Browser Automation Plugin for ElizaOS

This plugin enables ElizaOS agents to browse websites, interact with web
elements, and extract data using the Stagehand browser automation framework.

## Features

- **Browser Navigation**: Navigate to URLs, go back/forward, refresh pages
- **AI-Powered Interactions**: Click, type, and select elements using natural
  language
- **Data Extraction**: Extract structured data from web pages
- **Computer Use Integration**: Use OpenAI and Anthropic computer use models
- **CAPTCHA Solving**: Automatic CAPTCHA solving using CapSolver (Turnstile,
  reCAPTCHA, hCaptcha)
- **Session Management**: Handle multiple browser sessions efficiently
- **State Tracking**: Monitor browser state and page information

## Installation

```bash
npm install @elizaos/plugin-stagehand
```

## Configuration

### Environment Variables

```bash
# Optional - for cloud browser
BROWSERBASE_API_KEY=your_api_key
BROWSERBASE_PROJECT_ID=your_project_id

# Optional - for Computer Use features
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key

# Optional - for CAPTCHA solving
CAPSOLVER_API_KEY=your_capsolver_key

# Optional - for Truth Social testing
TRUTHSOCIAL_USERNAME=your_username
TRUTHSOCIAL_PASSWORD=your_password

# Optional - for TikTok testing
TIKTOK_USERNAME=your_username
TIKTOK_PASSWORD=your_password
TIKTOK_TEST_VIDEO_PATH=/path/to/test/video.mp4

# Browser settings
BROWSER_HEADLESS=true  # Run in headless mode (default: true)
```

## Usage

### Adding to Your Agent

```typescript
import { stagehandPlugin } from '@elizaos/plugin-stagehand';

const agent = {
  name: 'BrowserAgent',
  plugins: [stagehandPlugin],
  // ... other configuration
};
```

### Available Actions

#### BROWSER_NAVIGATE

Navigate to a specified URL.

**Examples:**

- "Go to google.com"
- "Navigate to https://github.com/elizaos/eliza"
- "Open the website example.com"

#### BROWSER_BACK

Go back to the previous page in browser history.

**Examples:**

- "Go back"
- "Previous page"
- "Navigate back"

#### BROWSER_FORWARD

Go forward in browser history.

**Examples:**

- "Go forward"
- "Next page"

#### BROWSER_REFRESH

Refresh the current page.

**Examples:**

- "Refresh the page"
- "Reload"

#### BROWSER_SOLVE_CAPTCHA

Detect and automatically solve CAPTCHA on the current page (requires
CAPSOLVER_API_KEY).

**Examples:**

- "Solve the captcha"
- "Handle the captcha on this page"
- "Bypass the captcha"

### Providers

#### BROWSER_STATE

Provides current browser state information including URL, title, and session
details.

The provider automatically includes browser state in the agent's context when
making decisions.

## CAPTCHA Solving

The plugin includes automatic CAPTCHA solving capabilities using CapSolver.
Supported CAPTCHA types:

- **Cloudflare Turnstile**: Automatically detected and solved
- **reCAPTCHA v2**: Including invisible reCAPTCHA
- **reCAPTCHA v3**: With configurable score thresholds
- **hCaptcha**: Standard hCaptcha challenges

### Setup

1. Get a CapSolver API key from [capsolver.com](https://capsolver.com)
2. Add to your `.env` file:
   ```bash
   CAPSOLVER_API_KEY=your_capsolver_api_key
   ```

### Automatic Detection

When navigating to a page with a CAPTCHA, the plugin will:

1. Automatically detect the CAPTCHA type
2. Extract the site key
3. Solve it using CapSolver
4. Inject the solution into the page
5. Continue with the automation flow

### Truth Social Login Test

A live scenario test is included to demonstrate CAPTCHA solving during login:

```bash
# Add credentials to .env
TRUTHSOCIAL_USERNAME=your_username
TRUTHSOCIAL_PASSWORD=your_password
CAPSOLVER_API_KEY=your_api_key

# Run the test
bun run test:e2e -- --name truthsocial_login_flow
```

This test will:

1. Navigate to Truth Social login page
2. Enter credentials
3. Automatically solve any Cloudflare Turnstile CAPTCHA
4. Complete the login process
5. Extract bearer token for API usage
6. Verify successful login

### TikTok Upload Test

A comprehensive test for TikTok login and video upload:

```bash
# Generate a test video (requires ffmpeg)
npm run generate-test-video

# Add credentials and video path to .env
TIKTOK_USERNAME=your_username
TIKTOK_PASSWORD=your_password
TIKTOK_TEST_VIDEO_PATH=./test-videos/test-video.mp4
CAPSOLVER_API_KEY=your_api_key

# Run the test
bun run test:e2e -- --name tiktok_login_and_upload
```

This test will:

1. Navigate to TikTok login page
2. Enter credentials using email/username method
3. Automatically solve any CAPTCHA if present
4. Extract authentication tokens
5. Navigate to upload page
6. Upload the specified video file
7. Add caption and hashtags
8. Set privacy to private (for testing)
9. Submit the video
10. Verify successful upload

## Development

### Setup

```bash
# Install dependencies
bun install

# Install Playwright browsers
bunx playwright install

# Build the plugin
bun run build
```

### Testing

```bash
# Run all tests
bun run test

# Run component tests with coverage
bun run test:component

# Run e2e tests
bun run test:e2e
```

### Project Structure

```
plugin-stagehand/
├── src/
│   └── index.ts          # Main plugin implementation
├── __tests__/
│   ├── service.test.ts   # Service tests
│   ├── actions.test.ts   # Action tests
│   ├── provider.test.ts  # Provider tests
│   └── integration.test.ts # Integration tests
├── e2e/
│   └── stagehand-plugin.test.ts # E2E tests
└── package.json
```

## API Reference

### StagehandService

The core service that manages browser sessions.

```typescript
class StagehandService extends Service {
  // Create a new browser session
  async createSession(sessionId: string): Promise<BrowserSession>;

  // Get an existing session
  async getSession(sessionId: string): Promise<BrowserSession | undefined>;

  // Get the current active session
  async getCurrentSession(): Promise<BrowserSession | undefined>;

  // Destroy a session
  async destroySession(sessionId: string): Promise<void>;
}
```

### BrowserSession

Represents an active browser session.

```typescript
class BrowserSession {
  id: string;
  stagehand: Stagehand;
  createdAt: Date;
  page: Page; // Playwright page object
}
```

## Roadmap

- [x] Phase 1: Basic browser navigation
- [x] Phase 2: Click, type, and select actions
- [x] Phase 3: Data extraction and screenshots
- [x] Phase 4: CAPTCHA solving with CapSolver
- [ ] Phase 5: Computer Use integration
- [ ] Phase 6: WebSocket integration for real-time updates

## Contributing

Contributions are welcome! Please ensure:

- All tests pass
- Code coverage remains high (target: 100%)
- Follow the existing code style
- Add tests for new features

## License

UNLICENSED

## Credits

Built with [Stagehand](https://github.com/browserbase/stagehand) - the AI-first
browser automation framework.

---

_Note: This plugin is under active development. Features and APIs may change._
