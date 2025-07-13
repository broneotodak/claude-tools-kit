#!/usr/bin/env node

/**
 * Restore Conversation State
 * Usage: node restore-conversation.js <conversation_id>
 */

const { ConversationMemoryManager } = require('./conversation-memory-manager');

async function restoreConversation(conversationId) {
    console.log(`🔄 Restoring conversation ${conversationId}...\n`);

    const manager = new ConversationMemoryManager(conversationId, 'General');
    const state = await manager.restoreFromMemory(conversationId);

    if (!state) {
        console.log('❌ No saved state found for this conversation');
        return;
    }

    console.log('✅ Conversation state restored!\n');
    
    // Show context summary
    console.log('📝 Context Stack:');
    state.context_stack.forEach((ctx, i) => {
        console.log(`${i + 1}. [${ctx.timestamp}] ${ctx.context.tool} - ${ctx.context.action}`);
    });

    // Show todos
    if (state.todo_stack.length > 0) {
        console.log('\n📋 Latest Todos:');
        const latestTodos = state.todo_stack[state.todo_stack.length - 1].todos;
        latestTodos.forEach(todo => {
            console.log(`- [${todo.status}] ${todo.content}`);
        });
    }
}

// Run if called directly
if (require.main === module) {
    const conversationId = process.argv[2];
    if (!conversationId) {
        console.error('Usage: node restore-conversation.js <conversation_id>');
        process.exit(1);
    }
    restoreConversation(conversationId);
}

module.exports = { restoreConversation };