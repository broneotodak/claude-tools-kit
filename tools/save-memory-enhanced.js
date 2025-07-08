#!/usr/bin/env node

/**
 * Enhanced memory saving tool for Claude Code
 * Ensures proper owner, source, and metadata structure
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Get credentials from environment
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const defaultOwner = process.env.DEFAULT_OWNER || 'neo_todak';

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing required environment variables:');
    console.error('   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Enhanced Memory Save Tool for Claude Code

Usage: node save-memory-enhanced.js [options] "memory content"

Options:
  --project, -p     Project name (default: "ClaudeN")
  --importance, -i  Importance level 1-10 (default: 5)
  --category, -c    Category (default: "Technical")
  --feature, -f     Feature name (default: "general")
  --machine, -m     Machine name (default: from hostname)
  --owner, -o       Owner (default: ${defaultOwner})
  --source, -s      Source (default: "claude_code")
  --help, -h        Show this help message

Examples:
  node save-memory-enhanced.js "Fixed the API integration issue"
  node save-memory-enhanced.js -p "FlowState AI" -i 7 "Implemented real-time updates"
  node save-memory-enhanced.js --project "TODAK" --category "Bug Fix" "Resolved WhatsApp webhook"
`);
    process.exit(0);
}

// Get memory content (last non-flag argument)
let content = args[args.length - 1];
if (content.startsWith('-')) {
    console.error('❌ No memory content provided');
    process.exit(1);
}

// Parse flags
function getArg(flags, defaultValue) {
    for (let i = 0; i < args.length - 1; i++) {
        if (flags.includes(args[i]) && i + 1 < args.length - 1) {
            return args[i + 1];
        }
    }
    return defaultValue;
}

// Get all parameters
const project = getArg(['--project', '-p'], 'ClaudeN');
const importance = parseInt(getArg(['--importance', '-i'], '5'));
const category = getArg(['--category', '-c'], 'Technical');
const feature = getArg(['--feature', '-f'], 'general');
const machine = getArg(['--machine', '-m'], require('os').hostname());
const owner = getArg(['--owner', '-o'], defaultOwner);
const source = getArg(['--source', '-s'], 'claude_code');

// Validate importance
if (importance < 1 || importance > 10) {
    console.error('❌ Importance must be between 1 and 10');
    process.exit(1);
}

async function saveMemory() {
    console.log('💾 Saving memory to Claude Desktop Memory...\n');

    // Build metadata according to claude.md format
    const metadata = {
        tool: "claude_code",
        feature: feature,
        machine: machine,
        project: project,
        actual_source: source,
        environment: process.platform === 'linux' ? 'WSL Ubuntu' : process.platform,
        date: new Date().toISOString().split('T')[0],
        user_id: owner // Include user_id in metadata for compatibility
    };

    // Determine memory type based on category or content
    let memory_type = 'general';
    if (category.toLowerCase().includes('bug') || category.toLowerCase().includes('fix')) {
        memory_type = 'bug_fix';
    } else if (category.toLowerCase().includes('solution')) {
        memory_type = 'technical_solution';
    } else if (category.toLowerCase().includes('project')) {
        memory_type = 'project_update';
    } else if (category.toLowerCase().includes('config')) {
        memory_type = 'configuration';
    } else if (category.toLowerCase().includes('milestone')) {
        memory_type = 'project_milestone';
    }

    // Prepare memory data
    const memoryData = {
        content: content,
        metadata: metadata,
        importance: importance,
        category: category,
        memory_type: memory_type, // Add required memory_type field
        owner: owner, // Explicitly set owner field
        source: source, // Explicitly set source field
        created_at: new Date().toISOString()
    };

    // Display what will be saved
    console.log('📝 Memory Details:');
    console.log(`   Content: ${content}`);
    console.log(`   Owner: ${owner}`);
    console.log(`   Project: ${project}`);
    console.log(`   Category: ${category}`);
    console.log(`   Importance: ${importance}/10`);
    console.log(`   Machine: ${machine}`);
    console.log(`   Source: ${source}`);
    console.log(`   Feature: ${feature}\n`);

    try {
        // Save to database
        const { data, error } = await supabase
            .from('claude_desktop_memory')
            .insert(memoryData)
            .select();

        if (error) {
            console.error('❌ Error saving memory:', error);
            process.exit(1);
        }

        if (data && data[0]) {
            console.log('✅ Memory saved successfully!');
            console.log(`   ID: ${data[0].id}`);
            console.log(`   Created: ${data[0].created_at}`);
            
            // Verify owner was set
            if (!data[0].owner) {
                console.warn('⚠️  Warning: Owner field was not set properly');
            }
        }

    } catch (error) {
        console.error('❌ Unexpected error:', error);
        process.exit(1);
    }
}

// Run the save operation
saveMemory();