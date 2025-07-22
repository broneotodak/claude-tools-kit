#!/usr/bin/env node

/**
 * Conversation Memory Manager for Claude Code
 * Automatically saves conversation context and progress
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const { MEMORY_TYPES, MEMORY_CATEGORIES } = require('../config/memory-constants');
const { getStandardizedMachineName } = require('./machine-detection');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

class ConversationMemoryManager {
    constructor(conversationId, project) {
        this.conversationId = conversationId;
        this.project = project;
        this.checkpointInterval = 5 * 60 * 1000; // 5 minutes
        this.backupTag = 'conversation_checkpoint'; // For n8n workflow filtering
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
     * Force save current state
     */
    async saveCheckpoint() {
        try {
            const memory = {
                user_id: 'neo_todak',
                memory_type: MEMORY_TYPES.TECHNICAL_SOLUTION,
                category: this.project,
                content: JSON.stringify({
                    conversation_id: this.conversationId,
                    context_stack: this.contextStack,
                    todo_stack: this.todoStack,
                    checkpoint_time: new Date().toISOString()
                }),
                metadata: {
                    tool: "claude_code",
                    feature: "conversation_checkpoint",
                    backup_tag: this.backupTag,
                    machine: getStandardizedMachineName(),
                    project: this.project,
                    actual_source: "claude_code",
                    environment: process.platform,
                    conversation_id: this.conversationId,
                    checkpoint_type: "auto",
                    date: new Date().toISOString().split('T')[0]
                },
                importance: 7, // High importance for conversation checkpoints
                source: 'claude_code'
            };

            const { error } = await supabase
                .from('claude_desktop_memory')
                .insert([memory]);

            if (error) {
                console.error('❌ Failed to save conversation checkpoint:', error);
                return false;
            }

            this.lastCheckpoint = new Date();
            console.log(`✅ Conversation checkpoint saved at ${this.lastCheckpoint.toISOString()}`);
            return true;
        } catch (err) {
            console.error('❌ Error saving checkpoint:', err);
            return false;
        }
    }

    /**
     * Restore conversation state from memory
     */
    async restoreFromMemory(conversationId) {
        try {
            const { data, error } = await supabase
                .from('claude_desktop_memory')
                .select('*')
                .eq('metadata->conversation_id', conversationId)
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