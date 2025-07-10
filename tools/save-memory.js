#!/usr/bin/env node

/**
 * Claude Code Memory Saver
 * 
 * Usage: node ~/claude-tools/save-memory.js "category" "title" "content" importance
 * Example: node ~/claude-tools/save-memory.js "ClaudeN" "Setup Complete" "Configured tools..." 4
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function saveMemory(category, title, content, importance = 4) {
    const os = require('os');
    const rawHostname = os.hostname();
    const platform = os.platform();
    
    // Standardize machine names
    let hostname = rawHostname;
    if (rawHostname.toLowerCase().includes('macbook')) {
        hostname = 'MacBook Pro';
    } else if (rawHostname === 'NEO-MOTHERSHIP' || rawHostname === 'DESKTOP-NEO-WIN11') {
        hostname = 'Windows Home PC';
    } else if (rawHostname.toLowerCase().includes('office')) {
        hostname = 'Windows Office PC';
    }
    
    const memory = {
        user_id: 'neo_todak',
        memory_type: 'technical_solution',
        category: category || 'ClaudeN',
        content: `${title}: ${content}`,
        metadata: {
            tool: "claude_code",
            feature: "claude_code_session",
            machine: hostname,
            project: category || "ClaudeN",
            actual_source: "claude_desktop",
            environment: platform,
            date: new Date().toISOString().split('T')[0]
        },
        importance: parseInt(importance) || 4,
        source: 'claude_desktop'
    };

    try {
        const { data, error } = await supabase
            .from('claude_desktop_memory')
            .insert([memory]);

        if (error) {
            console.error('❌ Error saving memory:', error);
            return;
        }

        console.log('✅ Memory saved successfully!');
        console.log(`📝 Category: ${memory.category}`);
        console.log(`🎯 Title: ${title}`);
        console.log(`⭐ Importance: ${memory.importance}`);
        console.log(`🖥️ Machine: ${memory.metadata.machine}`);
        console.log(`🔧 Tool: Claude Code`);
    } catch (err) {
        console.error('❌ Failed to save memory:', err);
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 3) {
    console.log('Usage: node save-memory.js "category" "title" "content" [importance]');
    console.log('Example: node save-memory.js "ClaudeN" "Setup Complete" "Configured all tools" 4');
    process.exit(1);
}

const [category, title, content, importance] = args;
saveMemory(category, title, content, importance);