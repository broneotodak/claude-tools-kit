#!/usr/bin/env node

/**
 * Claude Code Auto-Save System
 * Automatically saves conversation progress and context to memory
 * 
 * This tool ensures:
 * 1. Every significant prompt/response is saved
 * 2. Project states are versioned for corruption recovery
 * 3. Context is preserved for session continuity
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Memory configuration
const MEMORY_CONFIG = {
    autoSaveInterval: 2 * 60 * 1000, // 2 minutes
    contextWindow: 10, // Keep last 10 interactions
    importanceThreshold: 5, // Auto-save at importance 5+
    projectSnapshotInterval: 10 * 60 * 1000, // 10 minutes
};

class ClaudeCodeAutoSave {
    constructor() {
        this.sessionId = this.generateSessionId();
        this.currentProject = this.detectProject();
        this.contextBuffer = [];
        this.lastSnapshot = null;
        this.autoSaveTimer = null;
        this.snapshotTimer = null;
    }

    generateSessionId() {
        return `claude-code-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    }

    detectProject() {
        // Detect current project from cwd or git
        try {
            const cwd = process.cwd();
            const gitDir = path.join(cwd, '.git');
            
            if (fs.existsSync(gitDir)) {
                // Get project name from git remote or folder name
                return path.basename(cwd);
            }
            
            // Look for package.json
            const packagePath = path.join(cwd, 'package.json');
            if (fs.existsSync(packagePath)) {
                const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
                return pkg.name || path.basename(cwd);
            }
            
            return path.basename(cwd);
        } catch (e) {
            return 'unknown_project';
        }
    }

    async savePromptContext(prompt, response, metadata = {}) {
        const context = {
            timestamp: new Date().toISOString(),
            session_id: this.sessionId,
            project: this.currentProject,
            prompt: prompt.substring(0, 1000), // Truncate for storage
            response_summary: this.summarizeResponse(response),
            metadata: {
                ...metadata,
                tool: 'claude_code',
                machine: require('os').hostname(),
                environment: process.platform,
            }
        };

        this.contextBuffer.push(context);
        
        // Keep buffer size manageable
        if (this.contextBuffer.length > MEMORY_CONFIG.contextWindow) {
            this.contextBuffer.shift();
        }

        // Check if we should auto-save
        if (this.shouldAutoSave(metadata)) {
            await this.saveToMemory();
        }
    }

    shouldAutoSave(metadata) {
        // Auto-save triggers
        return (
            metadata.importance >= MEMORY_CONFIG.importanceThreshold ||
            metadata.isCritical ||
            metadata.isCompletion ||
            this.contextBuffer.length >= MEMORY_CONFIG.contextWindow
        );
    }

    summarizeResponse(response) {
        // Extract key actions from response
        const actions = [];
        
        if (response.includes('created file')) actions.push('file_created');
        if (response.includes('edited') || response.includes('modified')) actions.push('file_edited');
        if (response.includes('deleted')) actions.push('file_deleted');
        if (response.includes('error') || response.includes('failed')) actions.push('error_occurred');
        if (response.includes('fixed') || response.includes('resolved')) actions.push('issue_resolved');
        if (response.includes('git commit')) actions.push('git_commit');
        if (response.includes('npm install')) actions.push('dependencies_updated');
        
        return {
            actions,
            length: response.length,
            summary: response.substring(0, 200)
        };
    }

    async saveToMemory() {
        try {
            const memory = {
                user_id: 'neo_todak',
                memory_type: 'conversation',
                category: this.currentProject,
                content: JSON.stringify({
                    session_id: this.sessionId,
                    project: this.currentProject,
                    context_buffer: this.contextBuffer,
                    timestamp: new Date().toISOString()
                }),
                metadata: {
                    tool: 'claude_code',
                    feature: 'auto_save',
                    project: this.currentProject,
                    session_id: this.sessionId,
                    buffer_size: this.contextBuffer.length,
                    machine: require('os').hostname(),
                    date: new Date().toISOString().split('T')[0]
                },
                importance: 6,
                source: 'claude_code'
            };

            const { error } = await supabase
                .from('claude_desktop_memory')
                .insert([memory]);

            if (error) {
                console.error('❌ Auto-save failed:', error);
                return false;
            }

            console.log(`✅ Auto-saved ${this.contextBuffer.length} interactions at ${new Date().toLocaleTimeString()}`);
            return true;
        } catch (err) {
            console.error('❌ Error in auto-save:', err);
            return false;
        }
    }

    async createProjectSnapshot() {
        try {
            // Get critical project files for recovery
            const snapshot = {
                project: this.currentProject,
                timestamp: new Date().toISOString(),
                files: {}
            };

            // Identify critical files
            const criticalFiles = [
                'package.json',
                '.env.template',
                'README.md',
                'CLAUDE.md',
                '.cursorrules'
            ];

            for (const file of criticalFiles) {
                const filePath = path.join(process.cwd(), file);
                if (fs.existsSync(filePath)) {
                    snapshot.files[file] = {
                        exists: true,
                        size: fs.statSync(filePath).size,
                        modified: fs.statSync(filePath).mtime
                    };
                }
            }

            // Get git status if available
            try {
                const { execSync } = require('child_process');
                snapshot.git = {
                    branch: execSync('git rev-parse --abbrev-ref HEAD').toString().trim(),
                    commit: execSync('git rev-parse --short HEAD').toString().trim(),
                    status: execSync('git status --short').toString().trim()
                };
            } catch (e) {
                // Git not available
            }

            // Save snapshot to memory
            const memory = {
                user_id: 'neo_todak',
                memory_type: 'project_snapshot',
                category: this.currentProject,
                content: JSON.stringify(snapshot),
                metadata: {
                    tool: 'claude_code',
                    feature: 'project_snapshot',
                    project: this.currentProject,
                    session_id: this.sessionId,
                    snapshot_type: 'auto',
                    machine: require('os').hostname()
                },
                importance: 7,
                source: 'claude_code'
            };

            const { error } = await supabase
                .from('claude_desktop_memory')
                .insert([memory]);

            if (!error) {
                console.log(`📸 Project snapshot created for ${this.currentProject}`);
                this.lastSnapshot = new Date();
            }
        } catch (err) {
            console.error('❌ Snapshot creation failed:', err);
        }
    }

    async recoverFromCorruption(project, timestamp) {
        try {
            // Find nearest snapshot before corruption
            const { data, error } = await supabase
                .from('claude_desktop_memory')
                .select('*')
                .eq('memory_type', 'project_snapshot')
                .eq('category', project)
                .lt('created_at', timestamp)
                .order('created_at', { ascending: false })
                .limit(1);

            if (error || !data || data.length === 0) {
                console.error('❌ No recovery snapshot found');
                return null;
            }

            const snapshot = JSON.parse(data[0].content);
            console.log(`✅ Found recovery snapshot from ${snapshot.timestamp}`);
            
            // Show recovery information
            console.log('\n📋 Recovery Information:');
            console.log(`- Project: ${snapshot.project}`);
            console.log(`- Git Branch: ${snapshot.git?.branch || 'unknown'}`);
            console.log(`- Git Commit: ${snapshot.git?.commit || 'unknown'}`);
            console.log(`- Files tracked: ${Object.keys(snapshot.files).length}`);
            
            return snapshot;
        } catch (err) {
            console.error('❌ Recovery failed:', err);
            return null;
        }
    }

    start() {
        // Start auto-save timer
        this.autoSaveTimer = setInterval(() => {
            if (this.contextBuffer.length > 0) {
                this.saveToMemory();
            }
        }, MEMORY_CONFIG.autoSaveInterval);

        // Start snapshot timer
        this.snapshotTimer = setInterval(() => {
            this.createProjectSnapshot();
        }, MEMORY_CONFIG.projectSnapshotInterval);

        console.log(`🚀 Claude Code Auto-Save started`);
        console.log(`- Session: ${this.sessionId}`);
        console.log(`- Project: ${this.currentProject}`);
        console.log(`- Auto-save: every ${MEMORY_CONFIG.autoSaveInterval / 1000}s`);
        console.log(`- Snapshots: every ${MEMORY_CONFIG.projectSnapshotInterval / 1000}s`);
    }

    stop() {
        if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
        if (this.snapshotTimer) clearInterval(this.snapshotTimer);
        
        // Final save
        if (this.contextBuffer.length > 0) {
            this.saveToMemory();
        }
        
        console.log('🛑 Claude Code Auto-Save stopped');
    }
}

// CLI Interface
if (require.main === module) {
    const command = process.argv[2];
    const autoSave = new ClaudeCodeAutoSave();

    switch (command) {
        case 'start':
            autoSave.start();
            // Keep process alive
            process.on('SIGINT', () => {
                autoSave.stop();
                process.exit(0);
            });
            break;
            
        case 'save':
            // Manual save trigger
            const prompt = process.argv[3] || 'Manual save';
            const response = process.argv[4] || 'Progress saved';
            autoSave.savePromptContext(prompt, response, { importance: 6, isCompletion: true });
            break;
            
        case 'snapshot':
            // Create manual snapshot
            autoSave.createProjectSnapshot();
            break;
            
        case 'recover':
            // Recover from corruption
            const project = process.argv[3] || autoSave.currentProject;
            const timestamp = process.argv[4] || new Date().toISOString();
            autoSave.recoverFromCorruption(project, timestamp);
            break;
            
        default:
            console.log(`
Claude Code Auto-Save System

Usage:
  node claude-code-auto-save.js start     - Start auto-save daemon
  node claude-code-auto-save.js save      - Manual save current context
  node claude-code-auto-save.js snapshot  - Create project snapshot
  node claude-code-auto-save.js recover   - Recover from corruption

Features:
  ✅ Automatic prompt/response saving
  ✅ Project state snapshots for recovery
  ✅ Context preservation across sessions
  ✅ Corruption recovery mechanism
            `);
    }
}

module.exports = { ClaudeCodeAutoSave };