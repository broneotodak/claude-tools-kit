#!/usr/bin/env node

/**
 * Unified Memory Strategy for Claude Tools Kit
 * 
 * Ensures ALL project-specific memory saves follow the same pattern:
 * 1. Always save to pgVector (shows in FlowState)
 * 2. Optional local backup for critical items
 * 3. Project-specific metadata and categorization
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

/**
 * Unified Memory Manager
 * All projects should use this for consistent memory saving
 */
class UnifiedMemoryManager {
    constructor() {
        this.projectConfigs = {
            'THR': {
                path: '/Users/broneotodak/Projects/THR',
                database: 'ftbtsxlujsnobujwekwx',
                categories: ['feature', 'bug_fix', 'data_migration', 'ui_update', 'session'],
                hasLocalScript: true,
                localScript: 'scripts/thr-memory-utils.js'
            },
            'ATLAS': {
                path: '/Users/broneotodak/Projects/ATLAS',
                database: 'ftbtsxlujsnobujwekwx', // Shares with THR
                categories: ['asset', 'inventory', 'maintenance', 'report'],
                hasLocalScript: false
            },
            'todak-ai': {
                path: '/Users/broneotodak/Projects/todak-ai',
                database: 'custom',
                categories: ['whatsapp', 'ai', 'workflow', 'n8n'],
                hasLocalScript: false
            },
            'flowstate-ai': {
                path: '/Users/broneotodak/Projects/flowstate-ai',
                database: 'uzamamymfzhelvkwpvgt', // Memory database
                categories: ['dashboard', 'activity', 'visualization'],
                hasLocalScript: false
            },
            'claude-tools-kit': {
                path: '/Users/broneotodak/Projects/claude-tools-kit',
                database: 'uzamamymfzhelvkwpvgt', // Memory database
                categories: ['tool', 'agent', 'memory', 'ctk'],
                hasLocalScript: true,
                localScript: 'tools/universal-memory-save.js'
            }
        };

        // Detect current project
        this.currentProject = this.detectProject();
    }

    /**
     * Detect current project from working directory
     */
    detectProject() {
        const cwd = process.cwd();
        
        for (const [project, config] of Object.entries(this.projectConfigs)) {
            if (cwd.includes(config.path)) {
                return project;
            }
        }
        
        // Default to directory name
        return path.basename(cwd);
    }

    /**
     * MAIN SAVE METHOD - All projects should use this
     */
    async save(content, options = {}) {
        const {
            category = 'general',
            importance = 5,
            tags = [],
            localBackup = false,
            type = 'progress'
        } = options;

        const project = options.project || this.currentProject;
        const config = this.projectConfigs[project] || {};

        // Prepare memory object
        const memory = {
            content,
            project,
            category,
            importance,
            tags,
            type,
            metadata: {
                machine: await this.getMachineName(),
                tool: 'Claude Code',
                project,
                activity_type: category,
                flowstate_ready: true,
                timestamp: new Date().toISOString(),
                database: config.database,
                ...options.metadata
            }
        };

        // Step 1: Always save to pgVector first
        const pgVectorResult = await this.saveToPgVector(memory);
        
        // Step 2: Use project-specific script if available
        if (config.hasLocalScript && config.localScript) {
            await this.runProjectScript(project, config.localScript, memory);
        }

        // Step 3: Optional local backup
        if (localBackup) {
            await this.saveLocalBackup(memory);
        }

        return {
            success: pgVectorResult.success,
            pgVectorId: pgVectorResult.id,
            project,
            message: `Memory saved to pgVector (ID: ${pgVectorResult.id})`
        };
    }

    /**
     * Save to pgVector (claude_desktop_memory)
     */
    async saveToPgVector(memory) {
        try {
            const { data, error } = await supabase
                .from('claude_desktop_memory')
                .insert({
                    content: typeof memory.content === 'string' ? memory.content : JSON.stringify(memory.content),
                    metadata: memory.metadata,
                    owner: memory.metadata.machine || 'MacBook Pro',
                    importance: memory.importance,
                    source: 'claude_code'
                    // Note: project is stored in metadata, not as direct column
                })
                .select()
                .single();

            if (error) throw error;

            console.log(`✅ Saved to pgVector: ID ${data.id}`);
            return { success: true, id: data.id };

        } catch (error) {
            console.error('❌ pgVector save failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Run project-specific memory script
     */
    async runProjectScript(project, scriptPath, memory) {
        const config = this.projectConfigs[project];
        const fullPath = path.join(config.path, scriptPath);

        try {
            // Check if script exists
            await fs.access(fullPath);
            
            // For THR, use the specific memory utils
            if (project === 'THR') {
                const { THRMemory } = require(fullPath);
                
                switch (memory.category) {
                    case 'feature':
                        await THRMemory.saveFeature(memory.content);
                        break;
                    case 'bug_fix':
                        await THRMemory.saveBugFix(memory.content);
                        break;
                    case 'session':
                        await THRMemory.saveSession(memory.content, memory.tags);
                        break;
                    default:
                        await THRMemory.saveSession(memory.content);
                }
                
                console.log(`✅ Saved via THR memory utils`);
            }
        } catch (error) {
            console.log(`ℹ️  Project script not available, using pgVector only`);
        }
    }

    /**
     * Save local backup (optional)
     */
    async saveLocalBackup(memory) {
        const backupDir = path.join(
            this.projectConfigs[memory.project]?.path || process.cwd(),
            '.memory-backups'
        );

        try {
            await fs.mkdir(backupDir, { recursive: true });
            
            const filename = `${memory.project}-${Date.now()}.json`;
            const filepath = path.join(backupDir, filename);
            
            await fs.writeFile(filepath, JSON.stringify(memory, null, 2));
            console.log(`📁 Local backup: ${filename}`);
            
        } catch (error) {
            console.error('Local backup failed:', error.message);
        }
    }

    /**
     * Get normalized machine name
     */
    async getMachineName() {
        const os = require('os');
        const hostname = os.hostname().toLowerCase();
        
        if (hostname.includes('macbook')) return 'MacBook Pro';
        if (hostname.includes('mac')) return 'Mac';
        return hostname;
    }

    /**
     * Quick save methods for common operations
     */
    async saveFeature(description, project = null) {
        return this.save(description, {
            project,
            category: 'feature',
            importance: 6,
            type: 'feature'
        });
    }

    async saveBugFix(description, project = null) {
        return this.save(description, {
            project,
            category: 'bug_fix',
            importance: 7,
            type: 'fix'
        });
    }

    async saveProgress(description, project = null) {
        return this.save(description, {
            project,
            category: 'progress',
            importance: 5,
            type: 'progress'
        });
    }

    async saveCritical(description, project = null) {
        return this.save(description, {
            project,
            category: 'critical',
            importance: 9,
            type: 'critical',
            localBackup: true
        });
    }
}

// Sub-Agent Memory Integration
class SubAgentMemory extends UnifiedMemoryManager {
    constructor() {
        super();
        this.agentTypes = [
            'employee-agent',
            'payroll-agent',
            'leave-agent',
            'claims-agent',
            'reporting-agent',
            'database-agent'
        ];
    }

    /**
     * Save agent-specific memory
     */
    async saveAgentAction(agentType, action, details, project = 'THR') {
        return this.save(
            `[${agentType}] ${action}: ${details}`,
            {
                project,
                category: 'agent-action',
                importance: 6,
                tags: [agentType, 'automated'],
                metadata: {
                    agent_type: agentType,
                    action,
                    automated: true
                }
            }
        );
    }

    /**
     * Save workflow execution
     */
    async saveWorkflow(workflowName, steps, results, project = 'THR') {
        return this.save(
            `Workflow ${workflowName} completed: ${steps.length} steps`,
            {
                project,
                category: 'workflow',
                importance: 7,
                tags: ['workflow', 'orchestration'],
                metadata: {
                    workflow: workflowName,
                    steps,
                    results,
                    duration: results.duration || 0
                }
            }
        );
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    const manager = new UnifiedMemoryManager();
    const agentMemory = new SubAgentMemory();

    switch (command) {
        case 'save':
            const content = args.slice(1).join(' ');
            if (!content) {
                console.error('Usage: save <content>');
                process.exit(1);
            }
            await manager.save(content);
            break;

        case 'feature':
            const feature = args.slice(1).join(' ');
            await manager.saveFeature(feature);
            break;

        case 'bug':
            const bug = args.slice(1).join(' ');
            await manager.saveBugFix(bug);
            break;

        case 'agent':
            const [agentType, action, ...detailsParts] = args.slice(1);
            const details = detailsParts.join(' ');
            await agentMemory.saveAgentAction(agentType, action, details);
            break;

        case 'test':
            console.log('Testing Unified Memory Strategy...\n');
            
            // Test basic save
            await manager.save('Test memory from unified strategy');
            
            // Test project detection
            console.log(`Current project: ${manager.currentProject}`);
            
            // Test agent memory
            await agentMemory.saveAgentAction(
                'database-agent',
                'execute-sql',
                'Initialized leave balances for 2025'
            );
            
            console.log('\n✅ Tests complete!');
            break;

        default:
            console.log(`
Unified Memory Strategy for Claude Tools Kit

This ensures ALL projects save memory consistently:
1. Always to pgVector first (shows in FlowState)
2. Optional project-specific scripts
3. Optional local backups for critical items

Usage:
  node unified-memory-strategy.js <command> [options]

Commands:
  save <content>             Save general memory
  feature <description>      Save feature implementation
  bug <description>          Save bug fix
  agent <type> <action> <details>  Save agent action
  test                       Run tests

Examples:
  node unified-memory-strategy.js save "Completed THR module"
  node unified-memory-strategy.js feature "Added leave management"
  node unified-memory-strategy.js agent database-agent execute "Ran migration"

Projects configured:
  ${Object.keys(manager.projectConfigs).join(', ')}
            `);
    }
}

// Export for use as module
module.exports = {
    UnifiedMemoryManager,
    SubAgentMemory
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}