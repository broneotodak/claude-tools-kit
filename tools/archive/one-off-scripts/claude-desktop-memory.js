#!/usr/bin/env node

/**
 * Claude Desktop Memory Helper
 * Provides standardized memory saving for Claude Desktop to match Claude Code patterns
 */

const { createClient } = require('@supabase/supabase-js');
const { getStandardizedMachineName } = require('./machine-detection');
require('dotenv').config();

// Get credentials from environment
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const defaultOwner = process.env.DEFAULT_OWNER || 'neo_todak';

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing required environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Save memory using Claude Desktop format that matches Claude Code patterns
 * @param {object} options - Memory options
 * @returns {Promise<object>} Saved memory data
 */
async function saveClaudeDesktopMemory(options) {
    const {
        content,
        category = 'General',
        importance = 5,
        project = category,
        feature = 'claude_desktop_session',
        memory_type = 'technical_solution',
        owner = defaultOwner
    } = options;

    // Build metadata using Claude Code's successful pattern
    const metadata = {
        date: new Date().toISOString().split('T')[0],
        tool: 'claude_desktop',
        feature: feature,
        machine: getStandardizedMachineName(),
        project: project,
        environment: 'macOS',
        actual_source: 'claude_desktop',
        sync_timestamp: new Date().toISOString(),
        synced_to_flowstate: 'true'
    };

    // Prepare memory data
    const memoryData = {
        user_id: owner,
        content: content,
        metadata: metadata,
        importance: importance,
        category: category,
        memory_type: memory_type,
        owner: owner,
        source: 'claude_desktop',
        created_at: new Date().toISOString()
    };

    try {
        const { data, error } = await supabase
            .from('claude_desktop_memory')
            .insert(memoryData)
            .select();

        if (error) {
            console.error('❌ Error saving memory:', error);
            throw error;
        }

        if (data && data[0]) {
            console.log('✅ Claude Desktop memory saved successfully!');
            console.log(`   ID: ${data[0].id}`);
            console.log(`   Machine: ${metadata.machine}`);
            console.log(`   Tool: ${metadata.tool}`);
            console.log(`   Project: ${metadata.project}`);
            return data[0];
        }

        throw new Error('No data returned from insert');
    } catch (error) {
        console.error('❌ Failed to save memory:', error);
        throw error;
    }
}

// CLI Interface
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help')) {
        console.log(`
Claude Desktop Memory Helper

Usage: node claude-desktop-memory.js [options] "memory content"

Options:
  --project, -p     Project name (default: "General")
  --importance, -i  Importance level 1-10 (default: 5)
  --category, -c    Category (default: "General") 
  --feature, -f     Feature name (default: "claude_desktop_session")

Examples:
  node claude-desktop-memory.js "Fixed the API integration"
  node claude-desktop-memory.js -p "CTK" -c "Bug Fix" "Resolved machine detection"
`);
        process.exit(0);
    }

    // Parse arguments
    const content = args[args.length - 1];
    const project = args.includes('-p') ? args[args.indexOf('-p') + 1] : 
                   args.includes('--project') ? args[args.indexOf('--project') + 1] : 'General';
    const category = args.includes('-c') ? args[args.indexOf('-c') + 1] :
                    args.includes('--category') ? args[args.indexOf('--category') + 1] : 'General';
    const importance = args.includes('-i') ? parseInt(args[args.indexOf('-i') + 1]) :
                      args.includes('--importance') ? parseInt(args[args.indexOf('--importance') + 1]) : 5;
    const feature = args.includes('-f') ? args[args.indexOf('-f') + 1] :
                   args.includes('--feature') ? args[args.indexOf('--feature') + 1] : 'claude_desktop_session';

    saveClaudeDesktopMemory({
        content,
        category,
        importance,
        project,
        feature
    }).then(() => {
        process.exit(0);
    }).catch(error => {
        console.error('Failed to save memory:', error);
        process.exit(1);
    });
}

module.exports = { saveClaudeDesktopMemory };
