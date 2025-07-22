#!/usr/bin/env node

/**
 * Claude Code Memory Saver
 * 
 * Usage: node ~/claude-tools/save-memory.js "category" "title" "content" importance
 * Example: node ~/claude-tools/save-memory.js "ClaudeN" "Setup Complete" "Configured tools..." 4
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const { MEMORY_TYPES, MEMORY_CATEGORIES, IMPORTANCE_LEVELS } = require('../config/memory-constants');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function validateMemory(memory) {
    const errors = [];

    if (!memory.user_id) errors.push('user_id is required');
    if (!memory.category) errors.push('category is required');
    if (!memory.content) errors.push('content is required');
    if (!memory.memory_type) errors.push('memory_type is required');
    if (!memory.metadata?.machine) errors.push('metadata.machine is required');

    // Validate against constants
    if (!Object.values(MEMORY_TYPES).includes(memory.memory_type)) {
        errors.push(`Invalid memory_type. Must be one of: ${Object.values(MEMORY_TYPES).join(', ')}`);
    }

    if (memory.category && !Object.values(MEMORY_CATEGORIES).includes(memory.category)) {
        errors.push(`Invalid category. Must be one of: ${Object.values(MEMORY_CATEGORIES).join(', ')}`);
    }

    return errors;
}

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
        memory_type: MEMORY_TYPES.TECHNICAL_SOLUTION,
        category: category || MEMORY_CATEGORIES.CLAUDEN,
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
        source: 'claude_code'
    };

    try {
        // Validate memory before saving
        const errors = await validateMemory(memory);
        if (errors.length > 0) {
            console.error('❌ Validation errors:', errors.join(', '));
            return;
        }

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