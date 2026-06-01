#!/usr/bin/env node

/**
 * RAG Context Builder for Claude Code
 * Automatically builds relevant context for Claude based on current situation
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config();

// PORTED 2026-06-01: was reading the FROZEN legacy `claude_desktop_memory` table
// via process.env.SUPABASE_URL (silent stale data). Now reads the live neo-brain
// `memories` table through getNeoBrainClient().
const { getNeoBrainClient, MEMORY_TABLE } = require('./lib/neo-brain');

const supabase = getNeoBrainClient();

// Get current context
function getCurrentContext() {
    const context = {
        currentDir: process.cwd(),
        gitProject: null,
        recentFiles: [],
        environment: process.platform,
        timestamp: new Date().toISOString()
    };

    // Try to get git project info
    try {
        const gitRemote = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf-8' }).trim();
        const gitBranch = execSync('git branch --show-current 2>/dev/null', { encoding: 'utf-8' }).trim();
        if (gitRemote) {
            context.gitProject = {
                remote: gitRemote,
                branch: gitBranch,
                name: path.basename(gitRemote, '.git')
            };
        }
    } catch (e) {
        // Not a git repo
    }

    // Get recently modified files
    try {
        const files = execSync('find . -type f -name "*.js" -o -name "*.py" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" 2>/dev/null | head -10', { encoding: 'utf-8' })
            .split('\n')
            .filter(f => f.length > 0);
        context.recentFiles = files;
    } catch (e) {
        // Error finding files
    }

    return context;
}

async function buildContext() {
    console.log('🤖 Building RAG Context for Claude Code\n');

    const currentContext = getCurrentContext();
    const contextParts = [];

    // 1. Add current project context
    if (currentContext.gitProject) {
        contextParts.push(`## Current Project: ${currentContext.gitProject.name}`);
        contextParts.push(`Branch: ${currentContext.gitProject.branch}`);
        contextParts.push(`Directory: ${currentContext.currentDir}\n`);
    }

    // 2. Retrieve relevant memories based on project
    if (currentContext.gitProject) {
        console.log(`📚 Retrieving memories for project: ${currentContext.gitProject.name}`);
        
        const projName = currentContext.gitProject.name;
        const { data: projectMemories, error } = await supabase
            .from(MEMORY_TABLE)
            .select('*')
            .eq('archived', false)
            .or(`metadata->>project.eq.${projName},category.ilike.%${projName}%`)
            .order('importance', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(5);

        if (!error && projectMemories && projectMemories.length > 0) {
            contextParts.push('## Recent Project Context');
            projectMemories.forEach((memory, index) => {
                const date = new Date(memory.created_at).toLocaleDateString();
                contextParts.push(`\n### ${index + 1}. ${memory.category} (${date})`);
                contextParts.push(memory.content);
            });
            contextParts.push('');
        }
    }

    // 3. Get recent high-importance memories
    console.log('📝 Retrieving recent important memories...');
    
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const { data: recentMemories, error: recentError } = await supabase
        .from(MEMORY_TABLE)
        .select('*')
        .eq('archived', false)
        .gte('importance', 7)
        .gte('created_at', threeDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(3);

    if (!recentError && recentMemories && recentMemories.length > 0) {
        contextParts.push('## Recent Important Context');
        recentMemories.forEach((memory) => {
            const date = new Date(memory.created_at).toLocaleDateString();
            const proj = memory.metadata?.project || 'General';
            contextParts.push(`\n- [${date}] ${proj}: ${memory.content.substring(0, 150)}...`);
        });
        contextParts.push('');
    }

    // 4. Add recent decisions/solutions
    console.log('💡 Retrieving recent solutions...');
    
    const { data: solutions, error: solutionsError } = await supabase
        .from(MEMORY_TABLE)
        .select('*')
        .eq('archived', false)
        .or('memory_type.eq.technical_solution,memory_type.eq.decision,category.eq.Solution')
        .order('created_at', { ascending: false })
        .limit(3);

    if (!solutionsError && solutions && solutions.length > 0) {
        contextParts.push('## Recent Solutions & Decisions');
        solutions.forEach((memory) => {
            const date = new Date(memory.created_at).toLocaleDateString();
            contextParts.push(`\n- [${date}] ${memory.content.substring(0, 150)}...`);
        });
        contextParts.push('');
    }

    // 5. Add file context hint
    if (currentContext.recentFiles.length > 0) {
        contextParts.push('## Project Files');
        contextParts.push('Recent files in this directory:');
        currentContext.recentFiles.slice(0, 5).forEach(file => {
            contextParts.push(`- ${file}`);
        });
        contextParts.push('');
    }

    // Build final context
    const finalContext = contextParts.join('\n');

    // Save context to file
    const contextFile = path.join(process.env.HOME || process.env.USERPROFILE, '.claude-context');
    fs.writeFileSync(contextFile, finalContext);

    console.log(`\n✅ Context built and saved to: ${contextFile}`);
    console.log(`📏 Context size: ${finalContext.length} characters`);
    console.log('\n💡 Usage:');
    console.log('  1. Start Claude Code normally');
    console.log('  2. Include this context: cat ~/.claude-context');
    console.log('  3. Or use: claude-rag command (if configured)');

    // Optionally output the context
    if (process.argv.includes('--output') || process.argv.includes('-o')) {
        console.log('\n=== Generated Context ===\n');
        console.log(finalContext);
        console.log('\n=== End Context ===');
    }

    return finalContext;
}

// Run context builder
buildContext().catch(console.error);