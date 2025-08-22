#!/usr/bin/env node

/**
 * CTK Orchestration CLI
 * Simple command-line interface for running orchestrations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runOrchestration } from './strict_runner.mjs';
import { runHybrid } from './parallel_runner.mjs';
import detectProjectMode from './project_mode.mjs';
import validateConfig from './config.schema.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CTK_ROOT = path.resolve(__dirname, '..');

/**
 * Load project configuration
 * @param {string} projectName - Name of the project
 * @returns {object} - Project configuration
 */
function loadProjectConfig(projectName) {
  // Try multiple locations
  const locations = [
    path.join(__dirname, 'projects', projectName, 'orchestration.config.json'),
    path.join(CTK_ROOT, 'orchestration', 'projects', projectName, 'orchestration.config.json'),
    path.join(CTK_ROOT, '..', 'THR', 'orchestration.config.json'), // THR special case
    path.join(process.cwd(), 'orchestration.config.json'), // Current directory
  ];
  
  for (const location of locations) {
    if (fs.existsSync(location)) {
      console.log(`[CLI] Loading config from: ${location}`);
      const content = fs.readFileSync(location, 'utf8');
      return JSON.parse(content);
    }
  }
  
  throw new Error(`No configuration found for project: ${projectName}`);
}

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const options = {
    command: null,
    project: null,
    mode: null,
    dryRun: false,
    help: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === 'orchestrate') {
      options.command = 'orchestrate';
    } else if (arg === '--project' && i + 1 < args.length) {
      options.project = args[++i];
    } else if (arg === '--mode' && i + 1 < args.length) {
      options.mode = args[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  
  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
CTK Orchestration CLI
`);
  console.log(`Usage: node cli.mjs orchestrate --project <name> [options]\n`);
  console.log(`Commands:`);
  console.log(`  orchestrate              Run an orchestration\n`);
  console.log(`Options:`);
  console.log(`  --project <name>         Project name (required)`);
  console.log(`  --mode <sequential|hybrid>  Override execution mode`);
  console.log(`  --dry-run               Run in dry-run mode`);
  console.log(`  --help, -h              Show this help message\n`);
  console.log(`Environment Variables:`);
  console.log(`  CTK_PROJECT             Override project detection`);
  console.log(`  CTK_HITL=1              Enable Human-In-The-Loop approval`);
  console.log(`  CTK_LLM_WRAP=1          Enable LLM token telemetry`);
  console.log(`  CTK_MAX_PARALLEL=3      Max parallel workers (default: 3)`);
  console.log(`  CTK_TOOL_TIMEOUT_MS     Tool execution timeout (default: 120000)\n`);
  console.log(`Examples:`);
  console.log(`  node cli.mjs orchestrate --project THR`);
  console.log(`  node cli.mjs orchestrate --project analytics --mode hybrid`);
  console.log(`  CTK_HITL=1 node cli.mjs orchestrate --project THR --dry-run\n`);
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);
  
  if (options.help || !options.command) {
    showHelp();
    process.exit(0);
  }
  
  if (options.command !== 'orchestrate') {
    console.error(`Unknown command: ${options.command}`);
    showHelp();
    process.exit(1);
  }
  
  if (!options.project) {
    console.error('Error: --project is required');
    showHelp();
    process.exit(1);
  }
  
  try {
    // Load project configuration
    const config = loadProjectConfig(options.project);
    
    // Override mode if specified
    if (options.mode) {
      config.mode = options.mode;
    }
    
    // Detect project mode
    const projectMode = detectProjectMode();
    
    // Validate configuration
    validateConfig(config);
    
    // THR safety: default to dry-run unless CTK_APPROVED=1 explicitly set
    if ((projectMode.project === 'THR' || config.project === 'THR') && !options.dryRun && process.env.CTK_APPROVED !== '1') {
      console.error('THR runs require CTK_APPROVED=1; otherwise use --dry-run.');
      process.exit(1);
    }
    
    console.log('\n' + '█'.repeat(60));
    console.log('  CTK ORCHESTRATION CLI');
    console.log('█'.repeat(60));
    console.log(`\nProject: ${config.project || options.project}`);
    console.log(`Mode: ${config.mode || 'sequential'}`);
    console.log(`Dry Run: ${options.dryRun}`);
    
    if (process.env.CTK_HITL === '1') {
      console.log(`HITL: Enabled`);
    }
    if (process.env.CTK_LLM_WRAP === '1') {
      console.log(`LLM Telemetry: Enabled`);
    }
    
    let result;
    
    // Route to appropriate runner
    if (projectMode.project === 'THR' || config.project === 'THR' || config.mode === 'sequential') {
      console.log(`\nUsing: Strict Sequential Runner`);
      result = await runOrchestration(config, { dryRun: options.dryRun });
    } else if (config.mode === 'hybrid' || config.phases) {
      console.log(`\nUsing: Hybrid/Parallel Runner`);
      result = await runHybrid(config, { dryRun: options.dryRun });
    } else {
      console.log(`\nUsing: Strict Sequential Runner (default)`);
      result = await runOrchestration(config, { dryRun: options.dryRun });
    }
    
    // Print summary
    console.log('\n' + '═'.repeat(60));
    console.log('✓ Orchestration completed successfully');
    console.log(`Run ID: ${result.runId}`);
    console.log(`Agents executed: ${result.results?.length || 0}`);
    console.log(`Baton keys: ${Object.keys(result.baton || {}).join(', ') || 'none'}`);
    console.log('═'.repeat(60) + '\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n' + '═'.repeat(60));
    console.error('✗ Orchestration failed');
    console.error(`Error: ${error.message}`);
    console.error('═'.repeat(60) + '\n');
    
    if (process.env.DEBUG === '1') {
      console.error('Stack trace:');
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main, loadProjectConfig, parseArgs };