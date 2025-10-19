# ElizaOS AutoCoder Plugin

A comprehensive AI-powered code generation system for ElizaOS that enables
autonomous creation of plugins, n8n workflows, MCP servers, and provides
state-of-the-art evaluation capabilities using the Multi-SWE-bench benchmark
system.

## Overview

The AutoCoder plugin transforms ElizaOS into a powerful autonomous code
generation system capable of:

- Creating complete ElizaOS plugins from natural language descriptions
- Building n8n workflow automations with AI-generated configurations
- Generating Model Context Protocol (MCP) servers for tool integration
- Evaluating AI coding capabilities on real-world GitHub issues
- Generating fixes for TypeScript/JavaScript repositories with industry-leading
  success rates
- Providing comprehensive metrics and analysis of code generation performance

## Features

### 🚀 Code Generation Capabilities

#### ElizaOS Plugin Development

- **AI-Powered Code Generation**: Uses Claude (Anthropic) for sophisticated
  TypeScript plugin generation
- **Iterative Development**: Automatically refines code through up to 5
  iterations with self-improvement
- **Comprehensive Testing**: Built-in linting, testing with Bun test, and
  validation
- **Natural Language Support**: Create complex plugins from simple descriptions
- **Job Management**: Track and control plugin creation jobs with real-time
  status
- **Plugin Manager Integration**: Seamlessly integrates with ElizaOS Plugin
  Manager

#### N8n Workflow Creation

- **Natural Language to Workflow**: Generate complete n8n workflows from
  descriptions
- **JSON Specification Support**: Create workflows from detailed JSON specs
- **Integration Code Generation**: Automatically generates JavaScript for
  function nodes
- **Credential Management**: Identifies and documents required credentials
- **Documentation Generation**: Creates setup guides and README files
- **Import-Ready Output**: Generates workflow.json files ready for n8n import

#### MCP Server Generation

- **Tool Creation**: Build custom tools for AI model integration
- **Resource Management**: Generate resource endpoints for data access
- **Type-Safe Implementation**: Full TypeScript support with proper typing
- **Production Ready**: Complete with tests, documentation, and deployment
  configs

### 🧪 Multi-SWE-bench Evaluation System

- **Real-World Testing**: Evaluate code generation capabilities on actual GitHub
  issues from top repositories
- **Automated Patch Generation**: Generate fixes for TypeScript/JavaScript
  repositories using advanced AI
- **13-Step Workflow**: Complete iterative fix process with build validation and
  test execution
- **Comprehensive Metrics**: Success rates, compilation rates, execution times,
  and detailed cost tracking
- **AI-Powered Analysis**: Deep issue research, solution generation, and
  verification
- **Production-Ready Results**: Generates deployment-ready code fixes

## Quick Start

### Installation

1. Install the plugin in your ElizaOS project:

```bash
npm install @elizaos/plugin-autocoder
```

2. Set up your environment variables:

```bash
# Required for AI-powered code generation
ANTHROPIC_API_KEY=your_anthropic_key_here

# Enable SWE-bench evaluation (recommended)
SWE_BENCH_ENABLED=true

# Optional: Configure evaluation limits
SWE_BENCH_MAX_INSTANCES=10
SWE_BENCH_TIMEOUT=300000
```

3. Register the plugin in your agent configuration:

```typescript
import { autocoderPlugin } from '@elizaos/plugin-autocoder';

const agent = new Agent({
  plugins: [autocoderPlugin],
  // ... other configuration
});
```

### Usage Examples

#### Creating an ElizaOS Plugin

```
User: Create a plugin that tracks cryptocurrency prices and sends alerts

Agent: I'll create a cryptocurrency price tracking plugin with alert capabilities for you.
```

#### Building N8n Workflows

```
User: Create an n8n workflow that monitors GitHub for new issues and posts them to Slack

Agent: I'll create an n8n workflow that monitors GitHub for new issues and sends notifications to Slack.
```

#### Generating MCP Servers

```
User: Build an MCP server with tools for weather data and file operations

Agent: I'll create an MCP server with weather data capabilities and file operation tools.
```

# 🧪 SWE-bench Evaluation System

The AutoCoder plugin features a comprehensive integration with Multi-SWE-bench,
the premier benchmark for evaluating AI code generation capabilities on
real-world TypeScript and JavaScript repositories.

## What is SWE-bench?

SWE-bench (Software Engineering Benchmark) is a curated collection of real
GitHub issues from top open-source repositories including:

- **microsoft/TypeScript** - Core language implementation issues
- **axios/axios** - HTTP client library bugs and features
- **lodash/lodash** - Utility library improvements
- **webpack/webpack** - Build system enhancements
- And 50+ other high-quality repositories

It tests the ability to automatically generate production-ready code fixes for
actual bugs, feature requests, and improvements that real developers have worked
on.

## 📋 Prerequisites & Environment Setup

### Required Configuration

1. **Anthropic API Key** (Required)

   ```bash
   export ANTHROPIC_API_KEY="your-api-key-here"
   ```

2. **Enable SWE-bench Mode** (Required for evaluation actions)
   ```bash
   export SWE_BENCH_ENABLED=true
   ```

### System Requirements

- **Memory**: Minimum 8GB RAM recommended (16GB+ for large evaluations)
- **Storage**: 10-20GB free disk space for repository cloning and artifacts
- **Network**: Stable internet connection for GitHub cloning and API calls
- **Node.js**: Version 18+ with npm/yarn/pnpm support
- **Git**: For repository operations

### Optional Configuration

```bash
# Limit concurrent instances (default: 1)
export SWE_BENCH_MAX_INSTANCES=3

# Set timeout per instance in milliseconds (default: 300000 = 5 minutes)
export SWE_BENCH_TIMEOUT=600000

# Enable verbose logging
export SWE_BENCH_VERBOSE=true

# Custom working directory
export SWE_BENCH_WORK_DIR="./my-swe-bench-workspace"
```

## 🚀 Getting Started

### 1. Explore the Dataset

Before running evaluations, explore the available benchmark instances:

```bash
# In your agent conversation
User: Show me SWE-bench statistics
```

**Expected Response:**

```
📊 Multi-SWE-bench Dataset Statistics

Total Instances: 2,294

By Language:
- TypeScript: 1,245 (54.3%)
- JavaScript: 1,049 (45.7%)

Top Repositories:
- microsoft/TypeScript: 456 instances
- axios/axios: 189 instances
- lodash/lodash: 167 instances
- webpack/webpack: 145 instances
- moment/moment: 98 instances

Test Coverage:
- With tests: 2,156 (94.0%)
- Without tests: 138 (6.0%)
```

### 2. Run Your First Evaluation

Start with a small number of instances to understand the system:

```bash
# Run 3 TypeScript instances (recommended first run)
User: Run SWE-bench on 3 TypeScript instances

# Run specific repository
User: Run SWE-bench on microsoft/TypeScript

# Run specific instance by ID
User: Run SWE-bench instance axios__axios-5919
```

### 3. Scale Up Evaluations

Once comfortable with the system:

```bash
# Run 10 instances for better statistics
User: Run SWE-bench on 10 TypeScript instances

# Run all instances from a specific repository
User: Run SWE-bench on all axios/axios instances

# Run comprehensive evaluation
User: Run SWE-bench on 50 instances
```

## 🔄 The 13-Step Evaluation Workflow

Each SWE-bench instance follows a rigorous 13-step process designed to mirror
real-world development:

### Phase 1: Setup & Analysis (Steps 1-2)

1. **🚀 Repository Cloning**: Clone target repository at the exact commit where
   the issue was reported
2. **📚 Issue Research**: AI analyzes the GitHub issue, codebase structure, and
   related discussions

### Phase 2: Iterative Development (Steps 3-9)

3. **🔧 Fix Implementation**: Generate solution using advanced AI code
   generation with full codebase context
4. **✅ TypeScript Compilation**: Verify code compiles without errors
   (`tsc --noEmit`)
5. **✅ Linting**: Run code quality checks (ESLint where available)
6. **✅ Build Process**: Execute project build pipeline (`npm run build`)
7. **✅ Test Execution**: Run existing test suite to ensure no regressions
8. **🔍 Issue Verification**: Confirm the original issue is resolved
9. **📊 Iteration Analysis**: If tests fail, analyze failures and generate
   improved solution (up to 5 iterations)

### Phase 3: Validation & Finalization (Steps 10-13)

10. **🎯 Critical Review**: AI-powered code review of the solution for quality
    and correctness
11. **✔️ Final Verification**: Complete build and test validation to ensure
    production readiness
12. **📋 Result Generation**: Compile comprehensive metrics including
    performance, cost, and success metrics
13. **🧹 Cleanup**: Remove temporary files and repositories to prevent resource
    leaks

## 📝 Complete Running Instructions

### Method 1: Interactive Agent Conversations (Recommended)

The easiest way to run SWE-bench evaluations is through natural language
conversations with your ElizaOS agent:

#### Basic Usage

```bash
# Start your ElizaOS agent with the AutoCoder plugin
elizaos start

# In the conversation interface:
User: Show me SWE-bench statistics
User: Run SWE-bench on 3 TypeScript instances
User: Run SWE-bench instance microsoft__TypeScript-50497
```

#### Advanced Usage

```bash
# Filter by repository
User: Run SWE-bench on microsoft/TypeScript instances
User: Run SWE-bench on axios/axios instances

# Filter by complexity (estimated)
User: Run SWE-bench on easy instances
User: Run SWE-bench on complex instances

# Comprehensive evaluations
User: Run SWE-bench on 50 TypeScript instances
User: Run SWE-bench on all JavaScript instances
```

### Method 2: Direct Script Execution

For programmatic usage or CI/CD integration:

#### Single Test Instance

```bash
# Run individual test with default settings
bun scripts/run-swe-bench-test.ts

# Run with custom configuration
SWE_BENCH_MAX_INSTANCES=1 \
SWE_BENCH_TIMEOUT=600000 \
bun scripts/run-swe-bench-test.ts
```

#### Comprehensive Evaluation

```bash
# Run comprehensive evaluation
bun scripts/run-swe-bench-comprehensive.ts

# Run with artifact saving
SWE_BENCH_SAVE_ARTIFACTS=true \
bun scripts/run-swe-bench-comprehensive.ts
```

### Method 3: Programmatic API

For custom evaluation workflows and integration:

```typescript
import { SWEBenchRunner } from '@elizaos/plugin-autocoder';

// Basic configuration
const runner = new SWEBenchRunner(runtime, {
  max_instances: 5,
  language_filter: ['TypeScript', 'JavaScript'],
  save_artifacts: true,
  timeout_per_instance: 300000, // 5 minutes
});

await runner.initialize();
const report = await runner.runBenchmark();

console.log(
  `Resolved ${report.results.resolved_instances}/${report.results.total_instances} instances`
);
```

#### Advanced Configuration Options

```typescript
const runner = new SWEBenchRunner(runtime, {
  // Instance Selection
  instance_ids: ['axios__axios-5919', 'microsoft__TypeScript-50497'], // Specific instances
  max_instances: 10, // Limit total instances
  language_filter: ['TypeScript'], // Filter by language
  repo_filter: ['microsoft/TypeScript'], // Filter by repository
  complexity_filter: ['low', 'medium'], // Filter by estimated complexity

  // Execution Control
  timeout_per_instance: 300000, // 5 minutes per instance
  docker_enabled: false, // Use Docker isolation (future)
  save_artifacts: true, // Save generated patches and logs
  verbose: true, // Detailed logging
  skip_evaluation: false, // Skip final evaluation step

  // Performance
  max_parallel_instances: 1, // Concurrent processing limit
  cleanup_after_run: true, // Clean up temporary files
});
```

## 📊 Understanding Results & Metrics

### Performance Metrics Explained

The evaluation generates comprehensive metrics for thorough analysis:

#### Core Success Metrics

- **Resolution Rate**: Percentage of issues successfully fixed and verified
  (target: >30% for production systems)
- **Compilation Success Rate**: Percentage of patches that compile without
  errors (target: >90%)
- **Test Pass Rate**: Percentage of solutions that pass all existing tests
  (target: >80%)
- **Exact Match Rate**: Percentage matching ground truth solutions (research
  metric)

#### Performance Metrics

- **Average Execution Time**: Time per instance processing (typical: 2-5 minutes
  per instance)
- **Token Usage**: Total AI tokens consumed (prompt + completion)
- **Cost Analysis**: Detailed breakdown of API costs per instance and total
- **Iteration Count**: Average number of fix attempts before success

#### Quality Metrics

- **Success by Complexity**: Performance breakdown by estimated issue difficulty
- **Success by Repository**: Performance per source repository
- **Error Classification**: Common failure patterns and root causes
- **Requirements Coverage**: Percentage of issue requirements met

### Result Categories & Interpretation

#### ✅ **Fully Resolved**

- Issue completely fixed
- All tests pass
- Code compiles successfully
- Requirements fully met

#### ⚠️ **Partially Resolved**

- Code compiles successfully
- Some tests pass
- Issue partially addressed
- May require manual refinement

#### ❌ **Failed**

- Compilation errors persist
- Tests fail after all iterations
- Unable to understand issue
- Resource/timeout limits exceeded

### Artifacts & Output Files

When `save_artifacts: true` is enabled, comprehensive results are saved:

```
.swe-bench-work/
├── artifacts/                    # Generated code and patches
│   └── {instance_id}/
│       ├── generated.patch       # The actual code fix
│       ├── metadata.json        # Issue analysis and approach
│       └── iteration_logs/      # Per-iteration details
├── logs/                        # Execution logs
│   └── {run_id}/
│       ├── runner.log           # Main execution log
│       ├── repository.log       # Git operations log
│       └── evaluation.log      # Test execution log
├── reports/                     # Benchmark reports
│   ├── report-{run_id}.json     # Machine-readable results
│   └── summary-{run_id}.md      # Human-readable summary
└── results/                     # Raw evaluation data
    ├── patches.json             # All generated patches
    └── evaluation_results.json  # Detailed metrics
```

## 🎯 Example Evaluation Session

Here's what a typical SWE-bench evaluation looks like:

```bash
User: Run SWE-bench on 3 TypeScript instances

Agent: 🚀 Starting SWE-bench evaluation on 3 TypeScript instances...

📊 Processing Instance 1/3: microsoft__TypeScript-50497
🚀 STEP 1: Cloning repository at target commit...
📚 STEP 2: Researching issue and codebase...
   Issue: "Type narrowing not working with template literal types"
   Analysis: Complex type system issue requiring compiler changes
🔧 STEP 3: Implementing fix...
   Generated 127-line patch to src/compiler/checker.ts
✅ STEP 4: Running TypeScript compilation check...
✅ STEP 5: Running linting checks...
✅ STEP 6: Running build process...
✅ STEP 7: Running existing test suite...
✅ All tests pass! Issue appears to be resolved.

📊 Processing Instance 2/3: axios__axios-5919
🚀 STEP 1: Cloning repository at target commit...
📚 STEP 2: Researching issue and codebase...
   Issue: "Request timeout not working with HTTP/2"
   Analysis: HTTP adapter configuration issue
🔧 STEP 3: Implementing fix...
   Generated 45-line patch to lib/adapters/http.js
✅ STEP 4: Running TypeScript compilation check...
✅ STEP 5: Running linting checks...
✅ STEP 6: Running build process...
✅ STEP 7: Running existing test suite...
❌ 2 tests still failing, iterating...
🔧 STEP 3 (Iteration 2): Refining fix...
✅ All tests pass! Issue appears to be resolved.

📊 Processing Instance 3/3: lodash__lodash-8765
🚀 STEP 1: Cloning repository at target commit...
📚 STEP 2: Researching issue and codebase...
   Issue: "Performance regression in deep clone"
   Analysis: Algorithm optimization needed
🔧 STEP 3: Implementing fix...
   Generated 89-line patch to cloneDeep.js
✅ STEP 4: Running TypeScript compilation check...
✅ STEP 5: Running linting checks...
✅ STEP 6: Running build process...
✅ STEP 7: Running existing test suite...
❌ Performance benchmarks failing, iterating...
🔧 Attempted 5 iterations, unable to resolve performance requirements

✅ SWE-bench Evaluation Complete

📊 **Final Results Summary**:
- **Duration**: 8.5 minutes
- **Total Instances**: 3
- **Resolved**: 2 (66.7%) ⭐
- **Compilation Success**: 100%
- **Test Pass Rate**: 66.7%

📈 **Performance Analysis**:
- **Avg Execution Time**: 2.8 minutes per instance
- **Token Usage**: 45,230 tokens total
- **Total Cost**: $0.45 USD
- **Success by Complexity**:
  - Medium: 2/2 (100%)
  - High: 0/1 (0%)

🔧 **Common Issues**:
- Performance optimization: 1 occurrence
- Type system complexity: handled successfully

📁 **Artifacts Saved**:
- Generated patches: .swe-bench-work/artifacts/
- Detailed logs: .swe-bench-work/logs/run-20241215-143022/
- Full report: .swe-bench-work/reports/report-20241215-143022.json
```

## 🛠️ Troubleshooting & Optimization

### Common Issues & Solutions

#### 🚫 **API & Authentication Issues**

**Problem**: `Authentication Error` or `API key not configured`

```bash
# Solution: Verify API key is set correctly
echo $ANTHROPIC_API_KEY
export ANTHROPIC_API_KEY="your-actual-api-key-here"
```

**Problem**: `API Rate Limits` exceeded

```bash
# Solution: Reduce concurrent instances and add delays
export SWE_BENCH_MAX_INSTANCES=1
export SWE_BENCH_TIMEOUT=600000  # Longer timeout
```

#### 🌐 **Repository Access Errors**

**Problem**: `Git clone failed` or `Repository not accessible`

```bash
# Solution 1: Check internet connection and GitHub access
curl -I https://github.com/microsoft/TypeScript

# Solution 2: Configure Git credentials if needed
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

**Problem**: `Repository size too large`

```bash
# Solution: Increase timeout and disk space
export SWE_BENCH_TIMEOUT=900000  # 15 minutes
# Ensure 20GB+ free disk space
```

#### 🔧 **Build & Test Failures**

**Problem**: `Build Error` - Compilation failures

```bash
# Solution 1: Check logs for specific errors
cat .swe-bench-work/logs/*/repository.log

# Solution 2: Verify Node.js version compatibility
node --version  # Should be 18+
npm --version
```

**Problem**: `Test Failure` - Tests not passing

```bash
# Solution: Review test execution logs
cat .swe-bench-work/logs/*/evaluation.log

# Check for missing test dependencies
ls node_modules/.bin/  # Should contain test runners
```

#### 💾 **Resource & Performance Issues**

**Problem**: `Memory Issues` or system slowdown

```bash
# Solution: Reduce resource usage
export SWE_BENCH_MAX_INSTANCES=1
export SWE_BENCH_CLEANUP_AFTER_RUN=true

# Monitor memory usage
top -p $(pgrep -f "swe-bench")
```

**Problem**: `Disk space full`

```bash
# Solution: Clean up working directories
rm -rf .swe-bench-work/artifacts/  # Remove old artifacts
rm -rf .swe-bench-cache/          # Clear cache
```

#### ⏰ **Timeout & Hanging Issues**

**Problem**: Evaluations hanging or timing out

```bash
# Solution: Increase timeouts and enable verbose logging
export SWE_BENCH_TIMEOUT=900000    # 15 minutes
export SWE_BENCH_VERBOSE=true
export DEBUG=elizaos:plugin-autocoder:*
```

### Debug Mode & Detailed Logging

Enable comprehensive debugging for troubleshooting:

```bash
# Enable all debug output
export DEBUG=elizaos:plugin-autocoder:*
export SWE_BENCH_VERBOSE=true

# Enable specific component debugging
export DEBUG=elizaos:plugin-autocoder:repository-manager
export DEBUG=elizaos:plugin-autocoder:patch-generator
export DEBUG=elizaos:plugin-autocoder:evaluation-bridge

# Enable ElizaOS core debugging
export DEBUG=elizaos:*
```

**Log Locations:**

```bash
# Main execution logs
tail -f .swe-bench-work/logs/*/runner.log

# Repository operations (git, npm, tests)
tail -f .swe-bench-work/logs/*/repository.log

# AI model interactions
tail -f .swe-bench-work/logs/*/evaluation.log
```

### Performance Optimization Guide

#### 🔧 **Resource Management**

**Memory Allocation:**

- **Per Instance**: 500MB-1GB RAM during active processing
- **Concurrent Instances**: `memory_gb / 1GB = max_parallel_instances`
- **Total Peak**: `max_instances * 1GB + 2GB system overhead`

**Disk Space Planning:**

- **Per Repository**: 100-500MB for source code
- **Build Artifacts**: 200-800MB for compiled output
- **Total Per Instance**: 1-2GB including logs and patches
- **Recommended**: `max_instances * 2GB + 10GB free space`

#### ⚡ **Performance Tuning**

**For Fast Iteration (Development):**

```bash
export SWE_BENCH_MAX_INSTANCES=3
export SWE_BENCH_TIMEOUT=300000      # 5 minutes
export SWE_BENCH_CLEANUP_AFTER_RUN=true
export SWE_BENCH_SAVE_ARTIFACTS=false
```

**For Comprehensive Evaluation (Research):**

```bash
export SWE_BENCH_MAX_INSTANCES=50
export SWE_BENCH_TIMEOUT=900000      # 15 minutes
export SWE_BENCH_SAVE_ARTIFACTS=true
export SWE_BENCH_CLEANUP_AFTER_RUN=false  # Keep for analysis
```

**For Production Benchmarking:**

```bash
export SWE_BENCH_MAX_INSTANCES=100
export SWE_BENCH_TIMEOUT=1800000     # 30 minutes
export SWE_BENCH_DOCKER_ENABLED=true
export SWE_BENCH_SAVE_ARTIFACTS=true
```

#### 💰 **Cost Optimization**

**Token Usage Estimation:**

- **Simple Issues**: 5,000-15,000 tokens (~$0.05-$0.15)
- **Medium Issues**: 15,000-40,000 tokens (~$0.15-$0.40)
- **Complex Issues**: 40,000-100,000+ tokens (~$0.40-$1.00+)

**Cost Reduction Strategies:**

```bash
# Start with small batches to estimate costs
User: Run SWE-bench on 3 instances

# Target easier instances first
User: Run SWE-bench on easy instances

# Filter by specific repositories you care about
User: Run SWE-bench on axios/axios instances

# Monitor costs in real-time
grep "Total Cost" .swe-bench-work/reports/*.json
```

### Monitoring & Health Checks

#### 📊 **System Monitoring**

```bash
# Monitor active processes
ps aux | grep -i swe-bench

# Check disk usage
du -sh .swe-bench-work/
df -h

# Monitor network activity (for large repos)
netstat -i

# Check memory usage
free -h
```

#### 🔍 **Evaluation Health Checks**

```bash
# Check evaluation progress
tail -f .swe-bench-work/logs/*/runner.log | grep "Processing"

# Monitor success rates
grep -c "✅ All tests pass" .swe-bench-work/logs/*/runner.log

# Check for common failures
grep -c "❌" .swe-bench-work/logs/*/runner.log
```

### CI/CD Integration

For automated evaluation in CI/CD pipelines:

```yaml
# GitHub Actions example
name: SWE-bench Evaluation
on: [push, pull_request]

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Run SWE-bench evaluation
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SWE_BENCH_ENABLED: true
          SWE_BENCH_MAX_INSTANCES: 5
        run: bun scripts/run-swe-bench-test.ts

      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: swe-bench-results
          path: .swe-bench-work/reports/
```

# 🔧 Plugin Development System

## Plugin Creation Actions

The AutoCoder plugin provides powerful actions for creating ElizaOS plugins
through natural language or structured specifications.

### createPlugin

Creates a new plugin from a detailed JSON specification with full configuration
options.

```typescript
User: Create a plugin with the following specification:
{
    "name": "@elizaos/plugin-weather",
    "description": "Comprehensive weather information plugin with forecast capabilities",
    "actions": [
        {
            "name": "getCurrentWeather",
            "description": "Get current weather conditions for any location worldwide",
            "parameters": {
                "location": "string",
                "units": "metric|imperial|kelvin"
            }
        },
        {
            "name": "getWeatherForecast",
            "description": "Get 7-day weather forecast with detailed conditions",
            "parameters": {
                "location": "string",
                "days": "number"
            }
        }
    ],
    "environmentVariables": [
        {
            "name": "OPENWEATHER_API_KEY",
            "description": "OpenWeatherMap API key for weather data access",
            "required": true,
            "sensitive": true
        }
    ],
    "dependencies": {
        "axios": "^1.0.0",
        "@types/node": "^18.0.0"
    }
}
```

### createPluginFromDescription

Creates a complete plugin from a natural language description, automatically
inferring structure and requirements.

```typescript
User: I need a plugin that helps manage todo lists with add, remove, list, and priority management functionality. It should store todos in a local SQLite database and support due dates and categories.

Agent: I'll create a comprehensive todo management plugin for you with:
- SQLite database integration
- Priority levels and due date support
- Category organization
- Full CRUD operations
- Search and filtering capabilities

Starting plugin generation...
```

### checkPluginCreationStatus

Monitors real-time progress of plugin creation jobs with detailed status
updates.

```typescript
User: What's the status of my plugin creation?

Agent: 🔄 **Plugin Creation Status: In Progress**

**Current Phase**: Code Generation & Testing (Iteration 2/5)
**Progress**: 65% Complete
**Estimated Time Remaining**: 3.2 minutes

**Recent Activity**:
- ✅ Generated core plugin structure
- ✅ Created action handlers and validation
- ✅ Added TypeScript type definitions
- 🔄 Running comprehensive test suite
- 🔄 Building plugin with latest dependencies

**Test Results**:
- Unit Tests: 12/12 passed ✅
- Integration Tests: 3/4 passed ⚠️
- Type Checking: Passed ✅

**Next Steps**:
- Fix failing integration test
- Optimize error handling
- Generate documentation
```

## 🏗️ System Architecture

### Service Architecture Overview

```
AutoCodeService (Main Service)
├── OrchestrationManager           # Plugin lifecycle & workflow management
├── ComponentCreationManager       # AI-powered code generation engine
├── DynamicLoaderManager          # Runtime plugin loading & validation
└── SWEBenchRunner                # Advanced evaluation & benchmarking
    ├── DataLoader                # Multi-SWE-bench dataset management
    ├── RepositoryManager         # Git operations & dependency handling
    ├── IssueAnalyzer            # AI-powered issue understanding
    ├── PatchGenerator           # Intelligent code fix generation
    ├── EnhancedPatchGenerator   # Advanced multi-iteration fixes
    ├── ClaudeCodePatchGenerator # Claude Code SDK integration
    └── EvaluationBridge         # Results validation & metrics
```

### Directory Structure

```
packages/plugin-autocoder/
├── src/
│   ├── services/
│   │   └── AutoCodeService.ts           # Main orchestration service
│   ├── actions/
│   │   ├── plugin-creation-actions.ts   # Plugin development actions
│   │   └── swe-bench-action.ts         # Evaluation actions
│   ├── swe-bench/                      # SWE-bench evaluation system
│   │   ├── swe-bench-runner.ts         # Main evaluation orchestrator
│   │   ├── repository-manager.ts       # Git & build operations
│   │   ├── issue-analyzer.ts           # AI issue analysis
│   │   ├── patch-generator.ts          # Basic patch generation
│   │   ├── enhanced-patch-generator.ts # Advanced fix generation
│   │   ├── claude-code-patch-generator.ts # Claude Code integration
│   │   ├── evaluation-bridge.ts        # Results validation
│   │   ├── data-loader.ts             # Dataset management
│   │   └── types.ts                   # Type definitions
│   ├── managers/                       # Core workflow managers
│   │   ├── OrchestrationManager.ts    # Plugin creation orchestration
│   │   ├── ComponentCreationManager.ts # Code generation logic
│   │   ├── DynamicLoaderManager.ts    # Runtime loading
│   │   └── index.ts                   # Manager exports
│   └── utils/                         # Shared utilities
├── scripts/
│   ├── run-swe-bench-test.ts          # Single instance evaluation
│   └── run-swe-bench-comprehensive.ts # Full benchmark evaluation
└── __tests__/                         # Comprehensive test suite
    ├── unit/                          # Unit tests
    ├── integration/                   # Integration tests
    └── e2e/                          # End-to-end tests
```

## ⚙️ Configuration & Environment

### Required Environment Variables

```bash
# Core AI Integration (Required)
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# SWE-bench Evaluation (Optional but Recommended)
SWE_BENCH_ENABLED=true                    # Enable evaluation actions
SWE_BENCH_MAX_INSTANCES=10               # Limit concurrent evaluations
SWE_BENCH_TIMEOUT=300000                 # 5 minutes per instance
SWE_BENCH_SAVE_ARTIFACTS=true           # Save generated patches
SWE_BENCH_VERBOSE=false                  # Detailed logging
SWE_BENCH_WORK_DIR=./.swe-bench-work    # Custom working directory

# Plugin Development (Optional)
PLUGIN_DATA_DIR=./data                   # Plugin workspace directory
AUTOCODER_MAX_ITERATIONS=5               # Max plugin refinement iterations
AUTOCODER_TIMEOUT=600000                 # 10 minutes per plugin creation
```

### Advanced Service Configuration

```typescript
// AutoCode service configuration options
const autocoderConfig = {
  // Plugin Development Settings
  maxIterations: 5, // Maximum refinement iterations per plugin
  timeout: 600000, // Job timeout in milliseconds (10 minutes)
  workspace: './workspace', // Custom workspace directory
  buildCommand: 'npm run build', // Custom build command
  testCommand: 'npm test', // Custom test command

  // SWE-bench Evaluation Settings
  cleanup_after_run: true, // Clean up temporary files after evaluation
  max_parallel_instances: 1, // Concurrent evaluation limit
  save_intermediate_results: true, // Save results after each instance
  docker_enabled: false, // Use Docker isolation (future feature)

  // AI Model Configuration
  useClaudeCode: true, // Use Claude Code SDK (recommended)
  useEnhancedGenerator: false, // Use enhanced patch generator
  model_temperature: 0.2, // AI creativity level (0.0-1.0)
  max_tokens_per_request: 8192, // Maximum tokens per AI request
};
```

## 📚 Usage Examples

### Advanced Plugin Development

```typescript
// Complex database integration plugin
const databasePluginSpec = {
  name: '@elizaos/plugin-advanced-database',
  description:
    'Enterprise-grade database operations with connection pooling, migrations, and monitoring',
  actions: [
    {
      name: 'executeQuery',
      description: 'Execute parameterized SQL queries with connection pooling',
      parameters: {
        query: 'string',
        params: 'array',
        timeout: 'number',
        returnMode: 'all|first|count',
      },
    },
    {
      name: 'runMigration',
      description: 'Execute database migrations with rollback support',
      parameters: {
        migrationFile: 'string',
        direction: 'up|down',
        dryRun: 'boolean',
      },
    },
    {
      name: 'getConnectionStats',
      description: 'Monitor database connection pool statistics',
      parameters: {
        detailed: 'boolean',
      },
    },
  ],
  dependencies: {
    pg: '^8.11.0',
    'pg-pool': '^3.6.0',
    knex: '^2.5.0',
    '@types/pg': '^8.10.0',
  },
  environmentVariables: [
    {
      name: 'DATABASE_URL',
      description: 'PostgreSQL connection string with SSL support',
      required: true,
      sensitive: true,
      validation: '^postgresql://.*',
    },
    {
      name: 'DB_POOL_SIZE',
      description: 'Maximum database connection pool size',
      required: false,
      defaultValue: '10',
    },
  ],
  testingStrategy: {
    unitTests: true,
    integrationTests: true,
    performanceTests: true,
    mockDatabase: false, // Use real database for testing
  },
};
```

### Targeted SWE-bench Evaluations

```bash
# Repository-specific evaluation
User: Run SWE-bench on all microsoft/TypeScript instances with complexity medium or high

# Language and size filtering
User: Run SWE-bench on 25 JavaScript instances from popular repositories

# Specific issue types
User: Run SWE-bench instances related to performance optimization

# Custom evaluation with specific instances
User: Run SWE-bench on these specific instances: axios__axios-5919, lodash__lodash-8765, moment__moment-1234
```

## 🎯 Best Practices & Guidelines

### Plugin Development Excellence

1. **📋 Detailed Specifications**: Provide comprehensive descriptions,
   parameters, and use cases for optimal AI generation
2. **🔄 Iterative Refinement**: Allow the system to complete all 5 iterations
   for highest quality results
3. **🧪 Comprehensive Testing**: Generated plugins include unit, integration,
   and type checking tests
4. **🔐 Security First**: Use `sensitive: true` flags for API keys and
   credentials
5. **📖 Documentation**: Auto-generated plugins include detailed README and API
   documentation

### SWE-bench Evaluation Mastery

1. **🚀 Start Small**: Begin with 3-5 instances to understand system
   capabilities and resource requirements
2. **📊 Monitor Resources**: Track memory usage, disk space, and API costs
   during evaluations
3. **💾 Save Artifacts**: Enable artifact saving for detailed analysis of
   generated solutions
4. **🔍 Analyze Patterns**: Review failure patterns to identify improvement
   opportunities
5. **💰 Cost Management**: Monitor API usage and start with smaller batches to
   estimate total costs
6. **⚡ Performance Tuning**: Adjust timeouts and concurrency based on system
   capabilities

### Production Deployment

1. **🔒 Environment Security**: Never commit API keys; use environment variables
   and secret management
2. **📈 Scaling Considerations**: Plan for memory and disk usage when running
   large evaluations
3. **🔄 CI/CD Integration**: Integrate SWE-bench evaluations into automated
   testing pipelines
4. **📝 Monitoring & Alerting**: Set up monitoring for evaluation success rates
   and resource usage

## 🤝 Contributing

We welcome contributions to the AutoCoder plugin! Here's how to get involved:

### Development Setup

1. **Fork the repository** and clone your fork
2. **Install dependencies**: `npm install` or `bun install`
3. **Set up environment**: Copy `.env.example` to `.env` and configure API keys
4. **Run tests**: `elizaos test` to ensure everything works

### Contribution Guidelines

1. **🔧 Feature Development**: Create plugins, improve evaluation accuracy, or
   enhance the SWE-bench system
2. **🧪 Testing**: Add comprehensive tests for new functionality
3. **📊 Benchmarking**: Run SWE-bench evaluations to verify improvements
4. **📚 Documentation**: Update README and add code examples
5. **🔄 Pull Requests**: Submit well-documented PRs with clear descriptions

### Areas for Contribution

- **🎯 Evaluation Accuracy**: Improve success rates on SWE-bench instances
- **⚡ Performance**: Optimize resource usage and execution speed
- **🔌 Plugin Templates**: Create templates for common plugin patterns
- **🧠 AI Integration**: Enhance AI model usage and prompt engineering
- **🔍 Analysis Tools**: Build tools for analyzing evaluation results

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 🌟 What's Next?

The AutoCoder plugin represents the cutting edge of AI-powered software
engineering. With its comprehensive SWE-bench integration and sophisticated
plugin generation capabilities, it's designed to accelerate development and
provide rigorous evaluation of AI coding capabilities.

**Ready to get started?** Install the plugin, set your API key, and run your
first SWE-bench evaluation in minutes. The future of autonomous code generation
is here! 🚀
