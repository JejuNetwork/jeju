#!/usr/bin/env bun
/**
 * Leaderboard Pipeline CLI
 * 
 * Run with: bun run apps/gateway/src/leaderboard/cli.ts <command> [options]
 * 
 * Commands:
 *   ingest    - Fetch data from GitHub
 *   process   - Calculate contribution scores
 *   export    - Export stats to file/DWS
 *   summarize - Generate AI summaries
 *   all       - Run full pipeline (ingest -> process -> export)
 */

import { runIngest, runProcess, runExport, runSummarize } from './pipelines/index.js';

interface CLIOptions {
  repository?: string;
  after?: string;
  before?: string;
  days?: number;
  force?: boolean;
  verbose?: boolean;
  type?: 'contributor' | 'repository' | 'overall';
  interval?: 'day' | 'week' | 'month';
  uploadToDWS?: boolean;
  outputDir?: string;
}

function parseArgs(): { command: string; options: CLIOptions } {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const options: CLIOptions = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '-r':
      case '--repository':
        options.repository = nextArg;
        i++;
        break;
      case '-a':
      case '--after':
        options.after = nextArg;
        i++;
        break;
      case '-b':
      case '--before':
        options.before = nextArg;
        i++;
        break;
      case '-d':
      case '--days':
        options.days = parseInt(nextArg);
        i++;
        break;
      case '-f':
      case '--force':
        options.force = true;
        break;
      case '-v':
      case '--verbose':
        options.verbose = true;
        break;
      case '-t':
      case '--type':
        options.type = nextArg as 'contributor' | 'repository' | 'overall';
        i++;
        break;
      case '-i':
      case '--interval':
        options.interval = nextArg as 'day' | 'week' | 'month';
        i++;
        break;
      case '--upload':
        options.uploadToDWS = true;
        break;
      case '-o':
      case '--output':
        options.outputDir = nextArg;
        i++;
        break;
    }
  }

  return { command, options };
}

function printHelp(): void {
  console.log(`
📊 Leaderboard Pipeline CLI

Usage: bun run cli.ts <command> [options]

Commands:
  ingest      Fetch data from GitHub API
  process     Calculate contribution scores
  export      Export stats to file/DWS
  summarize   Generate AI summaries
  all         Run full pipeline

Options:
  -r, --repository <owner/name>  Target specific repository
  -a, --after <YYYY-MM-DD>       Start date
  -b, --before <YYYY-MM-DD>      End date
  -d, --days <number>            Days to look back
  -f, --force                    Force recalculation
  -v, --verbose                  Verbose output
  -t, --type <type>              Summary type (contributor|repository|overall)
  -i, --interval <interval>      Time interval (day|week|month)
  --upload                       Upload to DWS storage
  -o, --output <dir>             Output directory

Examples:
  bun run cli.ts ingest --days 7 -v
  bun run cli.ts process --after 2024-01-01
  bun run cli.ts export --upload
  bun run cli.ts summarize --type contributor --interval week
  bun run cli.ts all --days 30
`);
}

async function main(): Promise<void> {
  const { command, options } = parseArgs();

  console.log('📊 Leaderboard Pipeline');
  console.log('========================');

  const startTime = Date.now();

  switch (command) {
    case 'ingest':
      await runIngest(options);
      break;

    case 'process':
      await runProcess(options);
      break;

    case 'export':
      await runExport(options);
      break;

    case 'summarize':
      if (!options.type) {
        console.error('Error: --type required for summarize (contributor|repository|overall)');
        process.exit(1);
      }
      await runSummarize(options as Required<Pick<CLIOptions, 'type'>> & CLIOptions);
      break;

    case 'all':
      console.log('\n[1/3] Ingesting data...');
      await runIngest(options);
      
      console.log('\n[2/3] Processing scores...');
      await runProcess(options);
      
      console.log('\n[3/3] Exporting stats...');
      await runExport(options);
      break;

    case 'help':
    default:
      printHelp();
      process.exit(0);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${duration}s`);
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});



