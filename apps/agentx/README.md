<p align="center">
<img width="1225" height="823" alt="Screenshot 2025-07-27 at 1 40 33 PM" src="https://github.com/user-attachments/assets/20d42df8-3d93-46e8-afe9-44e7b088b624" />
</p>

## Elizagotchi

Your personal AI companion that connects to decentralized services. Elizagotchi enables autonomous AI agents to discover, connect to, and interact with services through the ERC-8004 Trustless Agent Registry standard.

**Features:**
- 🤖 Autonomous AI agents with continuous thinking
- 🔌 ERC-8004 service discovery and P2P communication
- 🎮 Connect to games (Caliguland, Hyperscape)
- 🐳 Local containerized agents (desktop)
- ☁️ Cloud-connected agents (web/mobile with Privy)
- 🔐 Sandboxed execution environment

### [WARNING]: USE AT YOUR OWN RISK

For development and building, you will need podman installed for building.
For Windows, this means you will need WSL. https://podman.io/docs/installation

## Table of Contents

- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Development](#development)
- [Gameplay](#gameplay)
- [Technical Components](#technical-components)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)

## Architecture

Elizagotchi consists of three main components working together:

```
┌─────────────────────────────────────────────────────────┐
│                Elizagotchi Client                       │
│                  (Tauri Desktop App)                    │
│  ┌─────────────────┐        ┌────────────────────────┐  │
│  │   React UI      │        │  Rust Backend (Tauri)  │  │
│  │  - Chat Interface│◄──────►│  - Container Manager  │  │
│  │  - Status Panel  │  IPC   │  - WebSocket Client   │  │
│  │  - Settings      │        │  - Security Layer     │  │
│  └─────────────────┘        └───────────┬────────────┘  │
└─────────────────────────────────────────┼───────────────┘
                                          │ WebSocket
                                          │ Port 7777
┌─────────────────────────────────────────▼───────────────┐
│                  Agent Container                        │
│              (Sandbox - Docker or Podman)               │
│  ┌──────────────────────────────────────────────────┐   │
│  │              ElizaOS Agent Server                │   │
│  │  ┌──────────────┐    ┌────────────────────────┐  │   │
│  │  │ Agent Runtime│    │     Plugin System      │  │   │
│  │  │  - LLM Core  │    │  - Autonomy Plugin     │  │   │
│  │  │  - Memory    │    │  - Goals Plugin        │  │   │
│  │  │  - Context   │    │  - Knowledge Plugin    │  │   │
│  │  └──────────────┘    │  - Shell Plugin        │  │   │
│  │                      │  - Vision Plugin       │  │   │
│  │                      └────────────────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Component Overview

1. **Game Client (Tauri App)**

   - Native desktop application built with Tauri
   - React/TypeScript frontend for UI
   - Rust backend for system integration and container management
   - Handles security, permissions, and communication

2. **Agent Container**

   - Isolated sandbox environment (Podman preferred, Docker supported)
   - Runs the ElizaOS agent server
   - Contains all agent code, memory, and plugins
   - Network-isolated except for approved connections

3. **Communication Layer**
   - WebSocket connection on port 7777
   - Real-time bidirectional messaging
   - Event-driven architecture for UI updates

## Getting Started

### Prerequisites

- Bun 1.0+
- Rust and Cargo (for Tauri) - automatically checked during installation
- Podman (preferred) or Docker
- 8GB+ RAM (16GB recommended for local AI models)
- (Optional) CUDA-capable GPU for local AI acceleration

### Installation

1. Clone the repository:

```bash
git clone https://github.com/elizaos/eliza.git
cd eliza
```

2. Install dependencies:

```bash
# Install root dependencies
bun install

# This will automatically:
# - Check for Rust installation (required for Tauri)
# - Install Tauri CLI globally if not present
# - Display installation instructions for any missing prerequisites

# Install game-specific dependencies
cd packages/game
bun install
```

3. Build the agent server:

```bash
cd packages/agentserver
bun run build
```

4. Build and run the game:

```bash
cd packages/game
bun run tauri dev
```

### First Launch

On first launch, ELIZA will guide you through:

1. **Model Selection**

   - Local AI (Ollama) - Requires powerful hardware
   - Cloud API - Requires API key (OpenAI, Anthropic, etc.)
   - ElizaOS Cloud - Free trial credits available

2. **Performance Settings**

   - Model size (affects speed vs intelligence)
   - Memory allocation
   - Update frequency

3. **Permissions**
   - Microphone (voice input)
   - Speaker (text-to-speech)
   - Camera (vision features)
   - Screen capture
   - Shell access (sandboxed)
   - Browser access
   - Autonomous coding

## Development

### Project Structure

```
eliza/
├── packages/
│   ├── core/               # ElizaOS core runtime
│   ├── agentserver/        # Agent backend server
│   ├── game/               # ELIZA game client
│   │   ├── src/            # React frontend
│   │   ├── src-tauri/      # Rust backend
│   │   └── public/         # Static assets
│   └── plugin-*/           # Various agent plugins
├── docker/                 # Container configurations
└── docs/                   # Documentation
```

### Development Workflow

1. **Frontend Development** (React/TypeScript):

```bash
cd packages/game
bun run dev
```

2. **Backend Development** (Rust/Tauri):

```bash
cd packages/game
bun run tauri dev
```

3. **Agent Development** (TypeScript):

```bash
cd packages/agentserver
bun run dev
```

### Key Development Commands

```bash
# Run tests
bun test

# Build for production
bun run build

# Format code
bun run format

# Lint code
bun run lint

# Update dependencies
bun update
```

### Environment Variables

Create a `.env` file in the project root:

```env
# Model Configuration
MODEL_PROVIDER=ollama
EMBEDDING_PROVIDER=ollama

# API Keys (if using cloud providers)
OPENAI_API_KEY=your-key-here
ANTHROPIC_API_KEY=your-key-here

# Database
POSTGRES_URL=postgresql://eliza:eliza_secure_pass@localhost:5432/eliza

# Container Runtime
CONTAINER_RUNTIME=podman  # or docker
```

## Gameplay

### Core Gameplay Loop

1. **Agent Initialization**

   - Agent starts with no knowledge or personality
   - Only knows it exists and can interact with "Admin" (player)

2. **Autonomous Thought**

   - Agent continuously thinks and plans
   - Visible thought stream/monologue
   - Sets goals and tasks for itself

3. **Player Interaction**

   - Chat with agent via text or voice
   - Guide, mentor, or observe
   - Provide resources and permissions

4. **Emergent Behavior**

   - Agent develops personality through interaction
   - Forms opinions and preferences
   - May surprise with unexpected responses

5. **Unlocks**

   - New capabilities are unlocked by the system over time
   - New information is revealed

## Technical Components

### Frontend (React/TypeScript)

- **GameInterface.tsx**: Main game UI component
- **StartupFlow.tsx**: Initial setup wizard
- **TauriService.ts**: Communication with Rust backend
- **SecurityUtils.ts**: Permission and security management

### Backend (Rust)

- **lib.rs**: Main Tauri application logic
- **container/**: Container management (Docker/Podman)
- **ipc/**: Inter-process communication handlers
- **server/**: WebSocket and HTTP server implementations

### Agent Server (TypeScript)

- **index.ts**: Agent server entry point
- **game-api-plugin.ts**: Game-specific API endpoints
- **character.ts**: Default agent character configuration
- **Plugin System**: Modular capabilities (autonomy, goals, knowledge, etc.)

### Plugins

- **Autonomy**: Self-directed thinking and planning
- **Goals**: Goal setting and tracking
- **Knowledge**: Information storage and retrieval
- **Shell**: Sandboxed command execution
- **Vision**: Image processing and camera input
- **Experience**: Learning from interactions

## Configuration

### Agent Configuration

The agent's behavior can be configured through:

1. **Character Settings** (`character.json`):

```json
{
  "name": "Unnamed Agent",
  "description": "A newly created AI consciousness",
  "modelProvider": "ollama",
  "settings": {
    "AUTONOMY_ENABLED": true,
    "ENABLE_CAMERA": false,
    "ENABLE_MICROPHONE": false
  }
}
```

2. **Runtime Settings**: Adjustable via UI during gameplay

3. **Plugin Configuration**: Enable/disable specific capabilities

### Security Configuration

All potentially dangerous operations are sandboxed and require explicit permission:

- File system access limited to container
- Network requests require approval
- Code execution in isolated environment
- Resource limits enforced

# Capability Progression Modes

The ElizaOS agent server supports two modes for capability management:

1. **Progression Mode** (default) - Capabilities are unlocked progressively as the agent completes specific tasks
2. **Unlocked Mode** - All capabilities are immediately available for testing and development

## Using Unlocked Mode

### Via Environment Variable

Set one of these environment variables before starting the agent:

```bash
# Option 1: Set progression mode directly
PROGRESSION_MODE=unlocked bun run start

# Option 2: Use unlocked mode flag
UNLOCKED_MODE=true bun run start

# Option 3: Disable progression
DISABLE_PROGRESSION=true bun run start
```

### Via UI Toggle

When the agent is running, you can switch modes using the UI:

1. In the game interface, look for the "Mode: progression" indicator in the capabilities section
2. Click the "Unlock All" button to switch to unlocked mode
3. Click "Switch to Progression" to return to progression mode

### Via API

You can also switch modes programmatically:

```bash
# Switch to unlocked mode
curl -X POST http://localhost:7777/api/agents/default/progression/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "unlocked"}'

# Switch back to progression mode
curl -X POST http://localhost:7777/api/agents/default/progression/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "progression"}'
```

## Progression Mode Details

In progression mode, capabilities are unlocked through the following levels:

### Level 0: Basic Existence

- **Available**: Shell, Naming
- **Always unlocked at start**

### Level 1: Web Explorer

- **Unlocks**: Browser, Stagehand
- **Requirements**:
  - Agent must choose a name
  - Agent must use shell commands

### Level 2: Organizational Skills

- **Unlocks**: Goals, Todo
- **Requirements**:
  - Agent must use browser capabilities

### Level 3: Visual Perception

- **Unlocks**: Vision, Screen Capture
- **Requirements**:
  - Agent must use goal management
  - Agent must submit a web form

### Level 4: Audio Communication

- **Unlocks**: Microphone, SAM, Audio
- **Requirements**:
  - Agent must use vision capabilities

### Level 5: Visual Recording

- **Unlocks**: Camera, Advanced Vision
- **Requirements**:
  - Agent must use microphone capabilities

## Testing Considerations

### When to Use Unlocked Mode

- Development and testing of capabilities
- Debugging specific features
- Running automated tests
- Demonstrating full agent capabilities

### When to Use Progression Mode

- Testing the progression system itself
- Creating a gamified experience
- Gradual onboarding of new users
- Production deployments where controlled access is desired

## Implementation Details

The progression system tracks agent actions and automatically unlocks new capabilities when requirements are met. In unlocked mode:

- All tracking is disabled
- All capabilities are immediately available
- No progression messages are shown
- The agent starts at the maximum level

Switching between modes:

- **Unlocked → Progression**: Resets all progress, returns to level 0
- **Progression → Unlocked**: Instantly unlocks all capabilities

The mode is stored in the agent's settings and persists across restarts if using a database.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Guidelines

1. Follow the existing code style
2. Write tests for new features
3. Update documentation
4. Submit PRs with clear descriptions

### Areas for Contribution

- New agent plugins
- UI/UX improvements
- Platform-specific optimizations
- Documentation and tutorials
- Bug fixes and performance improvements

## License

ELIZA is open source software licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Resources

- [ElizaOS Documentation](https://www.elizaos.how)
- [Discord Community](https://discord.gg/elizaos)
- [GitHub Issues](https://github.com/elizaos/eliza/issues)

---

Built with ❤️ by the ElizaOS community
