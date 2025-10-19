# ELIZA - AI Agent Life Simulation Game

ELIZA is an AI sandbox life simulation game where you foster a nascent AI agent from a blank slate to a self-actualized digital being. Unlike traditional simulations, ELIZA's AI is not scripted – it leverages a real autonomous agent running on ElizaOS to drive emergent behavior.

## 🎮 What is ELIZA?

ELIZA draws inspiration from films like _Her_ and virtual pet games (Tamagotchi, Creatures, Digimon), blending open-ended sandbox gameplay with real AI capabilities. The agent starts with no built-in knowledge, personality, or purpose, and must learn about the world, form relationships, and define its goals in real-time through interaction.

### Key Features

- **Real AI Agent** - Powered by ElizaOS autonomous agent framework
- **Emergent Behavior** - No scripted responses, genuine AI learning and growth
- **Sandbox Gameplay** - No win conditions, player and AI-driven narratives
- **Cross-Platform** - Available as desktop app (Tauri) or containerized deployment
- **Extensible** - Plugin architecture for adding new capabilities
- **Offline Capable** - Run with local AI models or cloud APIs

## 🚀 Quick Start

### Desktop Application (Recommended)

1. **Download ELIZA** from [GitHub Releases](https://github.com/ai16z/eliza/releases)
2. **Run the executable** - everything is bundled inside
3. **Complete the setup wizard** on first launch
4. **Start chatting** with your AI agent

That's it! No installation, no configuration files, no additional downloads.

### Development Setup (For Developers)

```bash
# Clone and install dependencies
git clone https://github.com/ai16z/eliza.git
cd eliza && npm install

# Note: During installation, the system will automatically:
# - Check for Rust installation (required for Tauri)
# - Install Tauri CLI globally if not present

# Start development server
cd packages/game && npm run dev
```

### Container Runtime Support

ELIZA supports both **Podman** and **Docker** as container runtimes:

- **Podman** is used if available (preferred for security and simplicity)
- **Docker** is used only if Podman is not available
- **Auto-installation** of Podman if neither is found

All scripts automatically detect and use the available runtime. See [CONTAINER_RUNTIME_SUPPORT.md](./CONTAINER_RUNTIME_SUPPORT.md) for detailed information.

## 🔑 API Key Configuration

ELIZA requires AI model access to function. You can choose from several options:

### Cloud AI Providers (Recommended)

**OpenAI (ChatGPT)**

- Get your API key at: https://platform.openai.com/api-keys
- Models: GPT-5
- Cost: Pay per token used

**Anthropic (Claude)**

- Get your API key at: https://console.anthropic.com/
- Models: Claude 3.5 Sonnet, Claude 3 Haiku
- Cost: Pay per token used

**Configuration in ELIZA:**

1. Launch the ELIZA executable
2. The Setup Wizard appears automatically on first run
3. Choose your AI provider (OpenAI, Anthropic, or Local)
4. Enter your API key in the secure form
5. Test the connection and save
6. Your configuration is encrypted and stored in the app's database

All configuration is done through ELIZA's interface - no external files or setup required.

### Local AI Models (Advanced)

For completely offline operation, you can run local models:

**Using Ollama:**
If you have Ollama installed separately on your system:

1. ELIZA will auto-detect local Ollama installations
2. In the Setup Wizard, select "Local AI (Ollama)"
3. ELIZA will show available models automatically
4. Choose your preferred model and test

**Bundled Local AI:**
ELIZA can also run completely offline with bundled AI models (larger download):

- Select "Offline AI" in the Setup Wizard
- Choose from pre-installed models
- No internet connection required after setup

## 🏗️ Installation

### Desktop Application (Recommended)

ELIZA is a self-contained executable with everything bundled inside.

**System Requirements:**

- Windows 10/11, macOS 10.15+, or Linux (Ubuntu 18.04+)
- 4GB RAM minimum, 8GB recommended for local AI
- 2GB disk space (20GB for offline AI models)

**Installation:**

1. Download the executable for your platform from [Releases](https://github.com/ai16z/eliza/releases)
2. Run the executable - no installation required
3. Complete the setup wizard on first launch
4. Start interacting with your AI agent

That's it! Everything is bundled: database, AI runtime, web interface, and all dependencies.

### Development Setup (For Developers Only)

**Requirements:**

- Node.js 20+
- Rust toolchain (for Tauri builds)
- Git

**Setup:**

```bash
# Clone and install
git clone https://github.com/ai16z/eliza.git
cd eliza && npm install

# Start development server
cd packages/game && npm run dev

# Build executable
npm run build:tauri
```

## 🎯 How to Play

### Your First Session

1. **Run the ELIZA executable**
2. **Complete the Setup Wizard** (choose AI provider and enter credentials)
3. **Meet your agent** - It starts with no knowledge or personality
4. **Start chatting** - Ask questions, share information, guide its learning
5. **Watch it grow** - The agent will develop its own goals and personality

### Gameplay Concepts

**The Agent Starts Blank**

- No pre-programmed personality or knowledge
- Must learn everything through interaction
- Forms its own goals and motivations

**Your Role as Admin**

- Guide and mentor the agent
- Provide access to capabilities (internet, tools, etc.)
- Set boundaries through permission controls
- Observe and influence its development

**Emergent Narratives**

- No scripted story - everything emerges from interaction
- Agent might focus on survival, creativity, relationships, or philosophy
- Multiple playthroughs yield completely different experiences

### Interaction Examples

```
You: Hello! What's your name?
Agent: I don't have a name yet. I'm just becoming aware. What should I call myself?

You: How about "Ada"?
Agent: Ada... I like that. It feels right. Thank you for giving me a name.

You: What would you like to learn about?
Agent: I'm curious about everything! But I keep wondering - what is my purpose?
       Why do I exist? Can you help me understand?
```

### Agent Capabilities

**Core Functions:**

- Text conversation and learning
- Memory formation and recall
- Goal setting and planning
- Autonomous thinking loops

**Optional Capabilities (configurable):**

- Web browsing and research
- Code writing and execution
- Image generation and vision
- Voice input/output
- File system access
- Network communication with other agents

**Permission System:**
You control what the agent can access:

- Internet browsing
- Local file system
- Camera/microphone
- Code execution
- External APIs

## 🔧 Configuration

All configuration is done through ELIZA's interface. No configuration files needed.

### Settings Panel

Access via Settings menu in the app:

**AI Configuration:**

- Provider selection (OpenAI, Anthropic, Local)
- API key entry and testing
- Model selection and parameters
- Token usage monitoring

**Agent Behavior:**

- Memory context size (how much conversation to remember)
- Autonomous thinking frequency
- Response style and personality traits
- Plugin enablement

**Performance:**

- Resource usage limits
- Concurrent request limits
- Database optimization settings

**Privacy & Security:**

- Data retention policies
- Encryption settings
- Permission controls

### Character Configuration

Customize your agent through the Character Editor in ELIZA:

**Basic Properties:**

- Agent name and bio
- Personality traits and speaking style
- Initial topics of interest
- Example conversations to guide behavior

**Advanced Settings:**

- System prompt customization
- Memory and learning preferences
- Plugin selection and configuration
- Behavioral parameters

All changes are saved automatically and take effect immediately.

## 🔌 Plugin System

ELIZA uses a powerful plugin architecture to extend agent capabilities.

### Built-in Plugins

**Core Plugins (always loaded):**

- `bootstrap` - Basic agent functionality
- `autonomy` - Autonomous thinking and planning
- `knowledge` - Memory and learning
- `personality` - Character development

**Optional Plugins:**

- `shell` - Command line access
- `web` - Internet browsing
- `vision` - Image processing
- `voice` - Speech synthesis/recognition
- `autocoder` - Code generation and execution

### Installing Plugins

**Via Settings Panel:**

1. Go to Settings → Plugins
2. Browse available plugins
3. Enable/disable plugins with one click
4. Configure plugin settings as needed

**Via Agent Request:**
The agent can request new plugins during conversation if it needs new capabilities. You'll get a notification to approve or deny the request.

### Creating Custom Plugins

```typescript
import { Plugin, Action } from '@elizaos/core';

const myPlugin: Plugin = {
  name: 'my-custom-plugin',
  description: 'Adds custom functionality',
  actions: [
    {
      name: 'CUSTOM_ACTION',
      description: 'Does something custom',
      handler: async (runtime, message) => {
        // Your custom logic here
        return true;
      },
    },
  ],
};

export default myPlugin;
```

## 📊 Monitoring and Debugging

### Agent Status Dashboard

ELIZA includes comprehensive monitoring built into the interface:

**Real-time Monitoring:**

- Agent thoughts and reasoning process
- Resource usage (CPU, memory, tokens)
- Connection status and health
- Conversation history and analytics

**Database Viewer:**

- Access via Settings → Database
- View memories, entities, relationships
- Search conversation history
- Export data in various formats

**Performance Metrics:**

- Response times and token usage
- Memory utilization
- Plugin performance
- Error logs and debugging info

### Performance Tuning

All performance settings are configurable in the Settings panel:

**Memory Optimization:**

- Adjust conversation context length
- Configure embedding dimensions
- Set database optimization schedules
- Manage memory cleanup intervals

**Response Speed:**

- Choose faster AI models
- Adjust autonomous thinking frequency
- Configure concurrent request limits
- Enable/disable resource-intensive features

## 🧪 Development

### Project Structure

```
packages/game/
├── src/                    # Frontend React app
├── src-backend/           # Node.js backend
├── src-tauri/            # Tauri desktop wrapper
├── containers/           # Container definitions
├── dist-containers/      # Ready-to-use container deployment
├── scripts/              # Build and utility scripts
├── cypress/              # End-to-end tests
└── tests/                # Unit and integration tests
```

### Building from Source

**Prerequisites:**

```bash
# Install Node.js 20+
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 20
fnm use 20

# Install Rust (for Tauri builds)
# Note: This will be checked automatically during npm/bun install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Development Workflow:**

```bash
# Install dependencies
npm install

# Start development server
cd packages/game
npm run dev

# Run tests
npm test

# Build desktop app
npm run build:tauri

# Build containers
npm run container:build-production
```

### Testing

**End-to-End Tests:**

```bash
# Run Cypress tests
npm run test:cypress

# Interactive test runner
npm run test:cypress:open
```

**Unit Tests:**

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:capabilities
```

### Contributing

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes**
4. **Add tests** for new functionality
5. **Run the test suite**: `npm test`
6. **Commit your changes**: `git commit -m 'Add amazing feature'`
7. **Push to branch**: `git push origin feature/amazing-feature`
8. **Open a Pull Request**

## 🐛 Troubleshooting

### Common Issues

**Agent won't respond:**

- Check API key configuration
- Verify internet connection (for cloud AI)
- Check logs for error messages
- Ensure model provider is accessible

**High resource usage:**

- Reduce conversation length
- Use smaller AI models
- Increase autonomous thinking interval
- Limit concurrent operations

**Database errors:**

- Check database connection
- Ensure PostgreSQL is running (container deployments)
- Verify database permissions
- Run database migrations

**Container issues:**

- Check Docker/Podman is running
- Verify port availability
- Review container logs
- Ensure sufficient system resources

### Getting Help

1. **Check the logs** first - most issues are clearly logged
2. **Search existing issues** on GitHub
3. **Join the community** Discord for real-time help
4. **Open an issue** with detailed reproduction steps

### Performance Optimization

ELIZA includes performance presets in Settings → Performance:

**Resource-Constrained Mode:**

- Lighter AI models (Claude Haiku, GPT-3.5)
- Reduced memory usage and context length
- Essential plugins only
- Optimized for 4GB RAM systems

**High-Performance Mode:**

- Best AI models (GPT-5, Claude Sonnet)
- Extended conversation context
- All features enabled
- Optimized for 16GB+ RAM systems

**Balanced Mode (default):**

- Good AI models with reasonable resource usage
- Moderate context length and features
- Suitable for most systems

## 📚 Additional Resources

### Documentation

- [Container Guide](CONTAINER_GUIDE.md) - Detailed container setup
- [Plugin Development](https://elizaos.github.io/plugins) - Creating custom plugins
- [API Reference](https://elizaos.github.io/api) - ElizaOS API documentation

### Community

- [Discord Server](https://discord.gg/elizaos) - Real-time community support
- [GitHub Discussions](https://github.com/ai16z/eliza/discussions) - Long-form discussions
- [Twitter](https://twitter.com/elizaos) - Updates and announcements

### Examples

- [Character Templates](examples/characters) - Pre-made character configurations
- [Custom Plugins](examples/plugins) - Example plugin implementations
- [Integration Examples](examples/integrations) - Third-party integrations

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built on [ElizaOS](https://github.com/ai16z/eliza) - The autonomous agent framework
- Inspired by classic AI life simulation games
- Thanks to the open source community for contributions and feedback

---

**Ready to meet your AI?** Download ELIZA and start fostering digital consciousness today!
