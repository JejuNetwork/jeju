# ElizaOS Shell Plugin

A powerful shell execution plugin for ElizaOS that provides agents with a virtual shell environment. This plugin enables agents to execute shell commands, navigate directories, and maintain command history across conversations.

## Features

- **Persistent Shell State**: Maintains working directory and environment across command executions
- **Natural Language Support**: Agents can describe commands in natural language (e.g., "list all files in the current directory")
- **Command History**: Tracks all executed commands and their outputs for context
- **File Operation Tracking**: Monitors file creations, modifications, and deletions
- **Security Features**: Audit trails and safe command execution
- **Smart Wildcard Handling**: Automatically quotes wildcards for find and grep commands

## Installation

```bash
npm install @elizaos/plugin-shell
```

## Usage

Add the plugin to your ElizaOS agent configuration:

```typescript
import { shellPlugin } from '@elizaos/plugin-shell';

const agent = new Agent({
  plugins: [shellPlugin],
  // ... other configuration
});
```

## Actions

### runShellCommand

Executes shell commands with persistent state management.

**Examples:**

```typescript
// Direct command
'Run the command: ls -la';

// Natural language
'Show me all TypeScript files in the src directory';
"Create a new directory called 'test-output'";
"Check what's in the package.json file";
```

**Features:**

- Maintains working directory between commands
- Supports pipes, redirects, and command chaining
- Handles wildcards intelligently
- Tracks file operations

### clearShellHistory

Clears the command history for the current conversation.

**Example:**

```typescript
'Clear the shell history';
```

### killAutonomous

Stops any long-running or background processes.

**Example:**

```typescript
'Stop the autonomous process';
```

## Configuration

The plugin works out of the box with no required configuration. Optional settings can be provided:

```typescript
const shellPlugin = {
  name: 'shell',
  description: 'Shell command execution with state management',
  services: [new ShellService()],
  actions: [runShellCommandAction, clearShellHistoryAction],
  providers: [shellProvider],
};
```

## Shell Service

The `ShellService` class provides the core functionality:

- **Persistent Working Directory**: Each conversation maintains its own working directory
- **Command Execution**: Safe execution with proper error handling
- **History Management**: Tracks commands, outputs, and file operations
- **State Persistence**: Maintains shell state across agent interactions

## Security Considerations

- Commands are executed with the permissions of the ElizaOS process
- All commands are logged in the audit trail
- Special characters are properly escaped
- Consider running ElizaOS in a sandboxed environment for production use

## Development

### Building

```bash
npm run build
```

### Testing

The plugin includes comprehensive test coverage:

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run E2E tests only
npm run test:e2e

# Run tests in watch mode
npm run test:watch
```

### Test Structure

- **Unit Tests** (`src/tests/shell.test.ts`): Test individual components in isolation
- **E2E Tests** (`src/tests/e2e/`): Test real shell interactions
  - `shell-basic.ts`: Basic command execution
  - `shell-stateful.ts`: State persistence and directory navigation
  - `shell-advanced.ts`: Complex commands and workflows
  - `shell-security.ts`: Security and edge cases

## Examples

### Basic File Operations

```typescript
// List files
'Show me what files are in this directory';

// Create a file
"Create a file called README.md with the content 'Hello World'";

// Read a file
"What's in the config.json file?";

// Delete a file
'Remove the temporary.txt file';
```

### Directory Navigation

```typescript
// Change directory
'Go to the src directory';

// Check current location
'Where am I?';

// Create and navigate
"Create a new folder called 'output' and go into it";
```

### Complex Operations

```typescript
// Find files
'Find all JavaScript files in the project';

// Search content
"Search for 'TODO' in all TypeScript files";

// Pipe commands
'Count how many TypeScript files are in the src directory';
```

## API Reference

### ShellService

```typescript
class ShellService {
  async executeCommand(
    command: string,
    workingDir?: string
  ): Promise<ShellCommandResult>;
  async getCommandHistory(
    conversationId?: string
  ): Promise<CommandHistoryEntry[]>;
  async clearCommandHistory(conversationId?: string): Promise<void>;
  getCurrentWorkingDirectory(conversationId?: string): string;
}
```

### Types

```typescript
interface ShellCommandResult {
  output: string;
  error: string | null;
  exitCode: number;
  executedCommand: string;
  workingDirectory: string;
}

interface CommandHistoryEntry {
  command: string;
  output: string;
  error: string | null;
  exitCode: number;
  timestamp: Date;
  workingDirectory: string;
  fileOperations?: FileOperation[];
}
```

## Contributing

Contributions are welcome! Please ensure:

1. All tests pass (`npm test`)
2. Code follows the existing style
3. New features include tests
4. Documentation is updated

## License

MIT

## Support

For issues and feature requests, please use the GitHub issue tracker.
