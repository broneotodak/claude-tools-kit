#!/usr/bin/env node

/**
 * Auto Memory Save Hook
 * Saves conversation state after each completion
 */

const { ConversationMemoryManager } = require('../tools/conversation-memory-manager');

async function handleCompletion(event) {
    const manager = new ConversationMemoryManager(
        event.conversation_id,
        event.metadata?.project || 'General'
    );

    // Save completion context
    manager.pushContext({
        type: 'completion',
        content: event.completion,
        prompt: event.prompt,
        timestamp: new Date().toISOString()
    });

    // Force save after each completion
    await manager.saveCheckpoint();
}

module.exports = { handleCompletion };