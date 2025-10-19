# Anthropic Plugin

This plugin provides integration with Anthropic's Claude models through the ElizaOS platform.

## Usage

Add the plugin to your character configuration:

```json
"plugins": ["@elizaos-plugins/plugin-anthropic"]
```

## Configuration

The plugin requires these environment variables (can be set in .env file or character settings):

```json
"settings": {
  "ANTHROPIC_API_KEY": "your_anthropic_api_key",
  "ANTHROPIC_SMALL_MODEL": "claude-3-5-haiku-latest",
  "ANTHROPIC_LARGE_MODEL": "claude-3-5-sonnet-latest",
  "ANTHROPIC_EXPERIMENTAL_TELEMETRY": "false"
}
```

Or in `.env` file:

```
ANTHROPIC_API_KEY=your_anthropic_api_key
# Optional overrides:
ANTHROPIC_SMALL_MODEL=claude-3-5-haiku-latest
ANTHROPIC_LARGE_MODEL=claude-3-5-sonnet-latest
ANTHROPIC_EXPERIMENTAL_TELEMETRY=false
```

### Configuration Options

- `ANTHROPIC_API_KEY` (required): Your Anthropic API credentials
- `ANTHROPIC_SMALL_MODEL`: Defaults to Claude 3 Haiku ("claude-3-5-haiku-latest")
- `ANTHROPIC_LARGE_MODEL`: Defaults to Claude 3 Sonnet ("claude-3-5-sonnet-latest")
- `ANTHROPIC_EXPERIMENTAL_TELEMETRY`: Enable experimental telemetry features for enhanced debugging and usage analytics (default: false)

### Experimental Telemetry

When ANTHROPIC_EXPERIMENTAL_TELEMETRY is set to true, the plugin enables advanced telemetry features that provide:

Enhanced debugging capabilities for model performance issues
Detailed usage analytics for optimization
Better observability into Anthropic API interactions
Foundation for future monitoring and analytics features through Sentry or other frameworks
Note: This feature is opt-in due to privacy considerations, as telemetry data may contain information about model usage patterns. Enable only when you need enhanced debugging or analytics capabilities.

To enable experimental telemetry, set `ANTHROPIC_EXPERIMENTAL_TELEMETRY=true` in your environment or character settings.

The plugin provides two model classes:

- `TEXT_SMALL`: Optimized for fast, cost-effective responses
- `TEXT_LARGE`: For more complex tasks requiring deeper reasoning
