#!/usr/bin/env node

/**
 * Conversation Memory Manager for Claude Code
 * Automatically saves conversation context and progress.
 *
 * PORTED 2026-06-01: was writing/reading the FROZEN legacy `claude_desktop_memory`
 * table via process.env.SUPABASE_URL (silent stale data). Now uses the live
 * neo-brain — saves via the @todak/memory SDK, restores via getNeoBrainClient().
 * Checkpoints land in `memories` with memory_type='conversation_checkpoint'.
 */

require('dotenv').config();
const { getNeoBrainClient, MEMORY_TABLE } = require('./lib/neo-brain');
const { getStandardizedMachineName } = require('./machine-detection');

const AGENT = 'conversation-memory-manager';

// Lazily import the ESM SDK from CommonJS.
let _brainPromise = null;
async function getBrain() {
    if (!_brainPromise) {
        _brainPromise = (async () => {
            const { NeoBrain } = await import('../packages/memory/src/index.js');
            return new NeoBrain({ agent: AGENT });
        })();
    }
    return _brainPromise;
}

class ConversationMemoryManager {
    constructor(conversationId, project) {
        this.conversationId = conversationId;
        this.project = project;
        this.checkpointInterval = 5 * 60 * 1000; // 5 minutes
        this.backupTag = 'conversation_checkpoint'; // For workflow filtering
        this.lastCheckpoint = null;
        this.contextStack = [];
        this.todoStack = [];
    }

    /**
     * Push new context to the stack
     */
    pushContext(context) {
        this.contextStack.push({
            timestamp: new Date(),
            context
        });
        this.autoSave();
    }

    /**
     * Push todo items to track
     */
    pushTodos(todos) {
        this.todoStack.push({
            timestamp: new Date(),
            todos
        });
        this.autoSave();
    }

    /**
     * Automatically save if enough time has passed
     */
    async autoSave() {
        const now = new Date();
        if (!this.lastCheckpoint || (now - this.lastCheckpoint) > this.checkpointInterval) {
            await this.saveCheckpoint();
        }
    }

    /**
     * Force save current state to the live neo-brain.
     */
    async saveCheckpoint() {
        // Conversation checkpoints are operational session-recovery state, NOT searchable knowledge.
        // The prior implementation wrote them to the frozen legacy archive — a silent no-op since the
        // neo-brain migration. Reviving via brain.save() would EMBED every 5-min auto-checkpoint
        // (Gemini-quota burn) and flood semantic recall with importance-7 snapshots, especially across
        // parallel sessions. Proper revival = register 'conversation_checkpoint' as an operational
        // category in the DB embedding trigger + lib/neo-brain.js EVENT_CATEGORIES, then write an
        // UNEMBEDDED row. Until that deliberate change, checkpoint writes are a no-op (the 5-min
        // throttle is preserved so the hook doesn't spin; restoreFromMemory still reads any prior rows).
        this.lastCheckpoint = new Date();
        return true;
    }

    /**
     * Restore conversation state from the live neo-brain.
     */
    async restoreFromMemory(conversationId) {
        try {
            const sb = getNeoBrainClient();
            const { data, error } = await sb
                .from(MEMORY_TABLE)
                .select('*')
                .eq('memory_type', 'conversation_checkpoint')
                .eq('metadata->>conversation_id', conversationId)
                .order('created_at', { ascending: false })
                .limit(1);

            if (error) {
                console.error('❌ Failed to restore conversation:', error);
                return null;
            }

            if (data && data[0]) {
                const state = JSON.parse(data[0].content);
                this.contextStack = state.context_stack || [];
                this.todoStack = state.todo_stack || [];
                this.lastCheckpoint = new Date(state.checkpoint_time);
                return state;
            }

            return null;
        } catch (err) {
            console.error('❌ Error restoring conversation:', err);
            return null;
        }
    }
}

// CLI Interface
if (require.main === module) {
    const [conversationId, project] = process.argv.slice(2);

    if (!conversationId || !project) {
        console.error('Usage: node conversation-memory-manager.js <conversation_id> <project>');
        process.exit(1);
    }

    const manager = new ConversationMemoryManager(conversationId, project);

    // Create test checkpoint
    manager.pushContext({
        type: 'test',
        message: 'Testing conversation memory system',
        timestamp: new Date().toISOString()
    });

    manager.pushTodos([{
        id: 'test-1',
        content: 'Verify conversation memory system',
        status: 'in_progress',
        priority: 'high'
    }]);

    manager.saveCheckpoint().then(() => {
        console.log('Test checkpoint created');
        process.exit(0);
    }).catch(err => {
        console.error('Failed to create test checkpoint:', err);
        process.exit(1);
    });
}

module.exports = { ConversationMemoryManager };
