#!/usr/bin/env node

import { AgentRuntime, type IAgentRuntime } from '@elizaos/core';
import { createInterface, type Interface } from 'readline';
import { v4 as uuidv4 } from 'uuid';

interface TestSession {
  sessionId: string;
  runtime: IAgentRuntime;
  projectPath?: string;
  currentProject?: {
    id: string;
    name: string;
    type: string;
    status: string;
    path?: string;
  };
}

// Simple service interfaces to avoid 'as any'
interface CodeGenService {
  generateCode(request: any): Promise<any>;
  stop(): Promise<void>;
}

interface E2bService {
  executeCode(code: string, options?: any): Promise<any>;
  stop(): Promise<void>;
}

class InteractiveClaudeCodeTester {
  private session: TestSession;
  private rl: Interface;

  constructor() {
    this.session = {
      sessionId: uuidv4(),
      runtime: {} as IAgentRuntime, // Will be initialized in start()
    };

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async start() {
    console.log('🚀 Starting Interactive Claude Code Tester');
    console.log('═'.repeat(50));

    try {
      // Initialize runtime
      const runtime = new AgentRuntime({
        plugins: [],
      });

      // Add mock implementations for testing
      const getValue = async (key: string) => {
        if (key === 'OPENAI_API_KEY') return process.env.OPENAI_API_KEY;
        if (key === 'E2B_API_KEY') return process.env.E2B_API_KEY;
        return '';
      };

      runtime.getSetting = getValue;

      const setValue = async (key: string, value: string | null) => {
        if (value === null) {
          delete (process.env as any)[key];
        } else {
          (process.env as any)[key] = value;
        }
      };

      runtime.setSetting = setValue;

      // Simple runtime extension instead of complex typing
      (runtime as any).isInitialized = true;

      // Store runtime in session
      this.session.runtime = runtime;

      // Verify services are available
      const codeGenService = runtime.getService('code-generation');
      const e2bService = runtime.getService('e2b');
      const formsService = runtime.getService('forms');

      if (!codeGenService) {
        console.log('⚠️  Code generation service not available');
      }
      if (!e2bService && process.env.E2B_API_KEY) {
        console.log('⚠️  E2B service not available (but API key is set)');
      }

      console.log('\n📋 Available Services:');
      console.log('─'.repeat(30));
      console.log(`   ${formsService ? '✅' : '❌'} forms`);
      console.log(`   ${codeGenService ? '✅' : '❌'} code-generation`);
      console.log(`   ${e2bService ? '✅' : '❌'} e2b`);

      console.log('\n✅ Runtime initialized successfully');
      this.showMainMenu();
    } catch (error) {
      console.error('❌ Failed to initialize runtime:', error);
      process.exit(1);
    }
  }

  private showMainMenu() {
    console.log('\n🎯 Main Menu');
    console.log('─'.repeat(20));
    console.log('1. Generate Project');
    console.log('2. Run Sandbox Command');
    console.log('3. Write File');
    console.log('4. Read File');
    console.log('5. List Files');
    console.log('6. Exit');
    console.log('');

    this.rl.question('Choose an option (1-6): ', (answer) => {
      this.handleMenuChoice(answer.trim());
    });
  }

  private async handleMenuChoice(choice: string) {
    try {
      switch (choice) {
        case '1':
          this.rl.question('Enter project description: ', (description) => {
            this.generateProject(description);
          });
          break;
        case '2':
          this.rl.question('Enter command to run: ', (command) => {
            this.runSandboxCommand(command);
          });
          break;
        case '3':
          this.rl.question('Enter filename: ', (filename) => {
            this.rl.question('Enter file content: ', (content) => {
              this.writeFile(filename, content);
            });
          });
          break;
        case '4':
          this.rl.question('Enter filename to read: ', (filename) => {
            this.readFile(filename);
          });
          break;
        case '5':
          this.rl.question('Enter path to list (default: .): ', (path) => {
            this.listFiles(path || '.');
          });
          break;
        case '6':
          await this.cleanup();
          console.log('👋 Goodbye!');
          process.exit(0);
          break;
        default:
          console.log('❌ Invalid choice. Please try again.');
          this.showMainMenu();
          break;
      }
    } catch (error) {
      console.error('❌ Error:', error);
      this.showMainMenu();
    }
  }

  private async callClaude(prompt: string) {
    console.log('🤖 Calling Claude...');
    console.log(`📝 Prompt: ${prompt}`);

    try {
      // This would normally call the Claude API through the runtime
      console.log('✅ Claude responded (mock response)');
      this.showMainMenu();
    } catch (error) {
      console.error('❌ Error calling Claude:', error);
    }
  }

  private async generateProject(description: string) {
    console.log('\n🚀 Generating project...');
    console.log(`📝 Description: ${description}`);

    const startTime = Date.now();

    const codeGenService = this.session.runtime.getService(
      'code-generation'
    ) as unknown as CodeGenService;
    if (!codeGenService) {
      throw new Error('Code generation service not available');
    }

    const request = {
      projectName: `generated-project-${Date.now()}`,
      description,
      requirements: [description],
      apis: [],
      targetType: 'plugin' as const,
      testScenarios: ['Basic functionality test'],
    };

    const result = await codeGenService.generateCode(request);
    const duration = Date.now() - startTime;

    console.log(`\n✅ Project Generated (${duration}ms):`);
    console.log('─'.repeat(50));
    console.log(`📁 Project: ${request.projectName}`);
    console.log(`✅ Success: ${result.success}`);

    if (result.projectPath) {
      console.log(`📂 Path: ${result.projectPath}`);
      this.session.currentProject = {
        id: result.id || uuidv4(),
        name: request.projectName,
        type: request.targetType,
        status: result.success ? 'completed' : 'failed',
        path: result.projectPath,
      };
      this.session.projectPath = result.projectPath;
    }

    this.showMainMenu();
  }

  private async runSandboxCommand(command: string) {
    console.log(`\n🔧 Running: ${command}`);

    const e2bService = this.session.runtime.getService('e2b') as unknown as E2bService;
    if (!e2bService) {
      console.log('❌ E2B service not available');
      return;
    }

    // Execute command in sandbox
    const result = await e2bService.executeCode(
      `
import subprocess
result = subprocess.run('${command}'.split(), capture_output=True, text=True)
print("STDOUT:", result.stdout)
print("STDERR:", result.stderr)
print("EXIT_CODE:", result.returncode)
      `,
      { timeout: 30000 }
    );

    if (result.text) {
      console.log(result.text);
    }
    if (result.error) {
      console.error('Error:', result.error);
    }

    this.showMainMenu();
  }

  private async writeFile(filename: string, content: string) {
    console.log(`\n📝 Writing file: ${filename}`);

    const e2bService = this.session.runtime.getService('e2b') as unknown as E2bService;
    if (!e2bService) {
      console.log('❌ E2B service not available');
      return;
    }

    await e2bService.executeCode(
      `
with open('${filename}', 'w') as f:
    f.write('''${content}''')
print(f"✅ File '{filename}' written successfully")
      `,
      { timeout: 30000 }
    );

    this.showMainMenu();
  }

  private async readFile(filename: string) {
    console.log(`\n📖 Reading file: ${filename}`);

    const e2bService = this.session.runtime.getService('e2b') as unknown as E2bService;
    if (!e2bService) {
      console.log('❌ E2B service not available');
      return;
    }

    const result = await e2bService.executeCode(
      `
try:
    with open('${filename}', 'r') as f:
        content = f.read()
    print("─" * 50)
    print(content)
    print("─" * 50)
except FileNotFoundError:
    print(f"❌ File '{filename}' not found")
      `,
      { timeout: 30000 }
    );

    if (result.text) {
      console.log(result.text);
    }

    this.showMainMenu();
  }

  private async listFiles(path: string) {
    console.log(`\n📁 Listing files in: ${path}`);

    const e2bService = this.session.runtime.getService('e2b') as unknown as E2bService;
    if (!e2bService) {
      console.log('❌ E2B service not available');
      return;
    }

    const result = await e2bService.executeCode(
      `
import os
import subprocess

# Try to use ls -la for better output
result = subprocess.run(['ls', '-la', '${path}'], capture_output=True, text=True)
if result.returncode == 0:
    print(result.stdout)
else:
    print(f"❌ Error: {result.stderr}")
      `,
      { timeout: 30000 }
    );

    if (result.text) {
      console.log(result.text);
    }

    this.showMainMenu();
  }

  private async cleanup() {
    console.log('\n🧹 Cleaning up...');

    // Stop all services through runtime
    if (this.session.runtime) {
      const e2bService = this.session.runtime.getService('e2b') as unknown as E2bService;
      if (e2bService && e2bService.stop) {
        await e2bService.stop();
        console.log('✅ E2B service stopped');
      }

      const codeGenService = this.session.runtime.getService(
        'code-generation'
      ) as unknown as CodeGenService;
      if (codeGenService && codeGenService.stop) {
        await codeGenService.stop();
        console.log('✅ Code generation service stopped');
      }
    }
  }
}

// Main execution
async function main() {
  const tester = new InteractiveClaudeCodeTester();
  await tester.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

export { InteractiveClaudeCodeTester };
