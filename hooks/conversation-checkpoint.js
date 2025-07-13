#!/usr/bin/env node

/**
 * Conversation Checkpoint Hook
 * Automatically saves conversation state on tool use
 */

const { ConversationMemoryManager } = require('../tools/conversation-memory-manager');

let memoryManager = null;

function initializeManager(conversationId, project) {
    if (!memoryManager) {
        memoryManager = new ConversationMemoryManager(conversationId, project);
    }
    return memoryManager;
}

/**
 * Hook handler for tool events
 */
async function handleToolEvent(event) {
    // Initialize manager if needed
    const manager = initializeManager(
        event.conversation_id,
        event.metadata?.project || 'General'
    );

    // Track context based on tool usage
    const context = {
        tool: event.tool,
        action: event.action,
        parameters: event.parameters,
        result: event.result,
        timestamp: new Date().toISOString()
    };

    // Push context to manager
    manager.pushContext(context);

    // If todos were modified, track them
    if (event.tool === 'TodoWrite') {
        manager.pushTodos(event.parameters.todos);
    }

    // Force save on certain high-value events
    if (['Edit', 'MultiEdit', 'Write'].includes(event.tool)) {
        await manager.saveCheckpoint();
    }
}

module.exports = { handleToolEvent };