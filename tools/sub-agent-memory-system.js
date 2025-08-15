#!/usr/bin/env node

/**
 * Sub-Agent Memory and Context Sharing System
 * 
 * Features:
 * - Distributed memory across agents
 * - Context propagation
 * - Knowledge graph building
 * - Memory persistence and retrieval
 * - Semantic search capabilities
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const EventEmitter = require('events');

require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Memory Types
const MEMORY_TYPES = {
    EPISODIC: 'episodic',        // Specific events and experiences
    SEMANTIC: 'semantic',         // Facts and knowledge
    PROCEDURAL: 'procedural',     // How to do things
    WORKING: 'working',           // Short-term active memory
    CONTEXTUAL: 'contextual'      // Current context and state
};

// Memory Priority Levels
const PRIORITY_LEVELS = {
    CRITICAL: 5,
    HIGH: 4,
    MEDIUM: 3,
    LOW: 2,
    TRIVIAL: 1
};

// Shared Memory Store
class SharedMemoryStore {
    constructor() {
        this.memories = new Map();
        this.indices = {
            byType: new Map(),
            byAgent: new Map(),
            byTag: new Map(),
            byTimestamp: new Map()
        };
        this.knowledgeGraph = new KnowledgeGraph();
    }

    /**
     * Store a memory
     */
    async store(memory) {
        const memoryId = memory.id || this.generateMemoryId();
        const enrichedMemory = {
            ...memory,
            id: memoryId,
            timestamp: memory.timestamp || new Date().toISOString(),
            version: 1,
            references: [],
            accessCount: 0
        };

        // Store in main map
        this.memories.set(memoryId, enrichedMemory);

        // Update indices
        this.indexMemory(enrichedMemory);

        // Add to knowledge graph
        await this.knowledgeGraph.addNode(enrichedMemory);

        // Persist to database
        await this.persistMemory(enrichedMemory);

        return memoryId;
    }

    /**
     * Retrieve a memory
     */
    async retrieve(memoryId) {
        const memory = this.memories.get(memoryId);
        if (memory) {
            memory.accessCount++;
            memory.lastAccessed = new Date().toISOString();
        }
        return memory;
    }

    /**
     * Search memories
     */
    async search(query) {
        const results = [];

        // Type-based search
        if (query.type) {
            const typeMemories = this.indices.byType.get(query.type) || [];
            results.push(...typeMemories);
        }

        // Agent-based search
        if (query.agentId) {
            const agentMemories = this.indices.byAgent.get(query.agentId) || [];
            results.push(...agentMemories);
        }

        // Tag-based search
        if (query.tags && query.tags.length > 0) {
            for (const tag of query.tags) {
                const tagMemories = this.indices.byTag.get(tag) || [];
                results.push(...tagMemories);
            }
        }

        // Time-based search
        if (query.timeRange) {
            const timeMemories = this.searchByTimeRange(query.timeRange);
            results.push(...timeMemories);
        }

        // Remove duplicates
        const uniqueResults = [...new Set(results)];

        // Apply filters
        let filtered = uniqueResults;
        if (query.priority) {
            filtered = filtered.filter(id => {
                const memory = this.memories.get(id);
                return memory && memory.priority >= query.priority;
            });
        }

        // Sort by relevance
        filtered.sort((a, b) => {
            const memA = this.memories.get(a);
            const memB = this.memories.get(b);
            return (memB.relevance || 0) - (memA.relevance || 0);
        });

        // Limit results
        const limit = query.limit || 100;
        return filtered.slice(0, limit).map(id => this.memories.get(id));
    }

    /**
     * Semantic search using embeddings
     */
    async semanticSearch(query, threshold = 0.7) {
        // This would integrate with a vector database
        // For now, we'll simulate with keyword matching
        const keywords = query.toLowerCase().split(' ');
        const results = [];

        for (const [id, memory] of this.memories) {
            const content = JSON.stringify(memory.content).toLowerCase();
            const matchScore = keywords.reduce((score, keyword) => {
                return score + (content.includes(keyword) ? 1 : 0);
            }, 0) / keywords.length;

            if (matchScore >= threshold) {
                results.push({
                    memory,
                    score: matchScore
                });
            }
        }

        return results.sort((a, b) => b.score - a.score);
    }

    /**
     * Index a memory for fast retrieval
     */
    indexMemory(memory) {
        // Index by type
        if (!this.indices.byType.has(memory.type)) {
            this.indices.byType.set(memory.type, []);
        }
        this.indices.byType.get(memory.type).push(memory.id);

        // Index by agent
        if (memory.agentId) {
            if (!this.indices.byAgent.has(memory.agentId)) {
                this.indices.byAgent.set(memory.agentId, []);
            }
            this.indices.byAgent.get(memory.agentId).push(memory.id);
        }

        // Index by tags
        if (memory.tags) {
            for (const tag of memory.tags) {
                if (!this.indices.byTag.has(tag)) {
                    this.indices.byTag.set(tag, []);
                }
                this.indices.byTag.get(tag).push(memory.id);
            }
        }

        // Index by timestamp
        const timestampKey = new Date(memory.timestamp).toISOString().split('T')[0];
        if (!this.indices.byTimestamp.has(timestampKey)) {
            this.indices.byTimestamp.set(timestampKey, []);
        }
        this.indices.byTimestamp.get(timestampKey).push(memory.id);
    }

    /**
     * Search by time range
     */
    searchByTimeRange(timeRange) {
        const results = [];
        const startDate = new Date(timeRange.start);
        const endDate = new Date(timeRange.end);

        for (const [dateKey, memoryIds] of this.indices.byTimestamp) {
            const date = new Date(dateKey);
            if (date >= startDate && date <= endDate) {
                results.push(...memoryIds);
            }
        }

        return results;
    }

    /**
     * Generate unique memory ID
     */
    generateMemoryId() {
        return `mem-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    }

    /**
     * Persist memory to database
     */
    async persistMemory(memory) {
        try {
            const { error } = await supabase
                .from('claude_desktop_memory')
                .insert({
                    source: 'agent-memory',
                    content: JSON.stringify(memory),
                    metadata: {
                        memory_id: memory.id,
                        memory_type: memory.type,
                        agent_id: memory.agentId,
                        priority: memory.priority,
                        tags: memory.tags
                    },
                    owner: 'sub-agent-memory-system'
                });

            if (error) throw error;
        } catch (error) {
            console.error('Error persisting memory:', error);
        }
    }

    /**
     * Get memory statistics
     */
    getStatistics() {
        const stats = {
            totalMemories: this.memories.size,
            byType: {},
            byAgent: {},
            mostAccessed: [],
            recentMemories: []
        };

        // Count by type
        for (const [type, ids] of this.indices.byType) {
            stats.byType[type] = ids.length;
        }

        // Count by agent
        for (const [agent, ids] of this.indices.byAgent) {
            stats.byAgent[agent] = ids.length;
        }

        // Find most accessed
        const memoriesArray = Array.from(this.memories.values());
        stats.mostAccessed = memoriesArray
            .sort((a, b) => b.accessCount - a.accessCount)
            .slice(0, 10)
            .map(m => ({ id: m.id, accessCount: m.accessCount }));

        // Get recent memories
        stats.recentMemories = memoriesArray
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 10)
            .map(m => ({ id: m.id, timestamp: m.timestamp }));

        return stats;
    }
}

// Knowledge Graph for relationship management
class KnowledgeGraph {
    constructor() {
        this.nodes = new Map();
        this.edges = new Map();
    }

    async addNode(memory) {
        const node = {
            id: memory.id,
            type: memory.type,
            data: memory,
            connections: new Set()
        };
        this.nodes.set(memory.id, node);

        // Auto-connect related memories
        await this.autoConnect(node);
    }

    async autoConnect(node) {
        // Connect based on tags
        if (node.data.tags) {
            for (const [otherId, otherNode] of this.nodes) {
                if (otherId !== node.id && otherNode.data.tags) {
                    const commonTags = node.data.tags.filter(tag => 
                        otherNode.data.tags.includes(tag)
                    );
                    if (commonTags.length > 0) {
                        this.addEdge(node.id, otherId, 'tagged', commonTags);
                    }
                }
            }
        }

        // Connect based on agent
        if (node.data.agentId) {
            for (const [otherId, otherNode] of this.nodes) {
                if (otherId !== node.id && otherNode.data.agentId === node.data.agentId) {
                    this.addEdge(node.id, otherId, 'same-agent', null);
                }
            }
        }

        // Connect based on temporal proximity
        const nodeTime = new Date(node.data.timestamp);
        for (const [otherId, otherNode] of this.nodes) {
            if (otherId !== node.id) {
                const otherTime = new Date(otherNode.data.timestamp);
                const timeDiff = Math.abs(nodeTime - otherTime);
                if (timeDiff < 60000) { // Within 1 minute
                    this.addEdge(node.id, otherId, 'temporal', timeDiff);
                }
            }
        }
    }

    addEdge(fromId, toId, type, metadata) {
        const edgeId = `${fromId}-${toId}`;
        if (!this.edges.has(edgeId)) {
            this.edges.set(edgeId, {
                from: fromId,
                to: toId,
                type,
                metadata,
                weight: 1
            });

            // Update node connections
            const fromNode = this.nodes.get(fromId);
            const toNode = this.nodes.get(toId);
            if (fromNode) fromNode.connections.add(toId);
            if (toNode) toNode.connections.add(fromId);
        }
    }

    getRelatedMemories(memoryId, depth = 2) {
        const visited = new Set();
        const related = [];

        const traverse = (id, currentDepth) => {
            if (currentDepth > depth || visited.has(id)) return;
            visited.add(id);

            const node = this.nodes.get(id);
            if (node && id !== memoryId) {
                related.push({
                    memory: node.data,
                    distance: currentDepth
                });
            }

            if (node) {
                for (const connectedId of node.connections) {
                    traverse(connectedId, currentDepth + 1);
                }
            }
        };

        traverse(memoryId, 0);
        return related.sort((a, b) => a.distance - b.distance);
    }
}

// Context Manager for sharing context between agents
class ContextManager extends EventEmitter {
    constructor() {
        super();
        this.contexts = new Map();
        this.globalContext = {};
        this.contextHistory = [];
    }

    /**
     * Create a new context
     */
    createContext(contextId, initialData = {}) {
        const context = {
            id: contextId,
            data: initialData,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            subscribers: new Set(),
            version: 1
        };

        this.contexts.set(contextId, context);
        this.emit('context-created', context);
        return context;
    }

    /**
     * Update context
     */
    updateContext(contextId, updates, agentId = null) {
        const context = this.contexts.get(contextId);
        if (!context) {
            throw new Error(`Context ${contextId} not found`);
        }

        // Store previous version in history
        this.contextHistory.push({
            contextId,
            version: context.version,
            data: { ...context.data },
            timestamp: new Date().toISOString(),
            updatedBy: agentId
        });

        // Apply updates
        context.data = { ...context.data, ...updates };
        context.updated = new Date().toISOString();
        context.version++;

        // Notify subscribers
        this.emit('context-updated', {
            contextId,
            updates,
            agentId,
            subscribers: Array.from(context.subscribers)
        });

        for (const subscriberId of context.subscribers) {
            this.emit(`context-update-${subscriberId}`, {
                contextId,
                updates,
                fullContext: context.data
            });
        }

        return context;
    }

    /**
     * Subscribe agent to context updates
     */
    subscribe(contextId, agentId) {
        const context = this.contexts.get(contextId);
        if (!context) {
            throw new Error(`Context ${contextId} not found`);
        }

        context.subscribers.add(agentId);
        return () => context.subscribers.delete(agentId);
    }

    /**
     * Get context
     */
    getContext(contextId) {
        return this.contexts.get(contextId);
    }

    /**
     * Merge contexts
     */
    mergeContexts(contextIds, newContextId) {
        const mergedData = {};
        const allSubscribers = new Set();

        for (const contextId of contextIds) {
            const context = this.contexts.get(contextId);
            if (context) {
                Object.assign(mergedData, context.data);
                for (const subscriber of context.subscribers) {
                    allSubscribers.add(subscriber);
                }
            }
        }

        const mergedContext = this.createContext(newContextId, mergedData);
        mergedContext.subscribers = allSubscribers;

        return mergedContext;
    }

    /**
     * Get context history
     */
    getHistory(contextId = null) {
        if (contextId) {
            return this.contextHistory.filter(h => h.contextId === contextId);
        }
        return this.contextHistory;
    }

    /**
     * Update global context
     */
    updateGlobalContext(updates, agentId = null) {
        this.globalContext = { ...this.globalContext, ...updates };
        this.emit('global-context-updated', {
            updates,
            agentId,
            fullContext: this.globalContext
        });
        return this.globalContext;
    }

    /**
     * Get global context
     */
    getGlobalContext() {
        return this.globalContext;
    }
}

// Memory-Enhanced Agent
class MemoryEnhancedAgent {
    constructor(agentId, type, memoryStore, contextManager) {
        this.id = agentId;
        this.type = type;
        this.memoryStore = memoryStore;
        this.contextManager = contextManager;
        this.workingMemory = [];
        this.maxWorkingMemory = 10;
    }

    /**
     * Remember something
     */
    async remember(content, type = MEMORY_TYPES.EPISODIC, metadata = {}) {
        const memory = {
            agentId: this.id,
            type,
            content,
            priority: metadata.priority || PRIORITY_LEVELS.MEDIUM,
            tags: metadata.tags || [],
            context: this.contextManager.getGlobalContext(),
            ...metadata
        };

        const memoryId = await this.memoryStore.store(memory);
        
        // Add to working memory
        this.addToWorkingMemory(memoryId);
        
        return memoryId;
    }

    /**
     * Recall memories
     */
    async recall(query) {
        // First check working memory
        const workingMemories = await Promise.all(
            this.workingMemory.map(id => this.memoryStore.retrieve(id))
        );

        // Then search broader memory
        const searchResults = await this.memoryStore.search({
            ...query,
            agentId: this.id
        });

        return {
            working: workingMemories.filter(m => m !== null),
            longTerm: searchResults
        };
    }

    /**
     * Learn from experience
     */
    async learn(experience, lesson) {
        // Store the experience
        const experienceId = await this.remember(experience, MEMORY_TYPES.EPISODIC, {
            priority: PRIORITY_LEVELS.HIGH,
            tags: ['experience']
        });

        // Store the lesson learned
        const lessonId = await this.remember(lesson, MEMORY_TYPES.PROCEDURAL, {
            priority: PRIORITY_LEVELS.HIGH,
            tags: ['lesson', 'learned'],
            relatedTo: experienceId
        });

        return { experienceId, lessonId };
    }

    /**
     * Share knowledge with other agents
     */
    async shareKnowledge(targetAgentId, knowledge) {
        const sharedMemory = await this.remember(knowledge, MEMORY_TYPES.SEMANTIC, {
            priority: PRIORITY_LEVELS.HIGH,
            tags: ['shared', `to-${targetAgentId}`],
            sharedWith: targetAgentId
        });

        // Emit event for target agent
        this.contextManager.emit(`knowledge-shared-${targetAgentId}`, {
            from: this.id,
            memoryId: sharedMemory,
            knowledge
        });

        return sharedMemory;
    }

    /**
     * Add to working memory with LRU eviction
     */
    addToWorkingMemory(memoryId) {
        this.workingMemory.unshift(memoryId);
        if (this.workingMemory.length > this.maxWorkingMemory) {
            this.workingMemory.pop();
        }
    }

    /**
     * Clear working memory
     */
    clearWorkingMemory() {
        this.workingMemory = [];
    }

    /**
     * Get agent memory stats
     */
    async getMemoryStats() {
        const allMemories = await this.memoryStore.search({ agentId: this.id });
        return {
            agentId: this.id,
            type: this.type,
            workingMemorySize: this.workingMemory.length,
            totalMemories: allMemories.length,
            memoryTypes: allMemories.reduce((acc, mem) => {
                acc[mem.type] = (acc[mem.type] || 0) + 1;
                return acc;
            }, {})
        };
    }
}

// Main Memory System Manager
class SubAgentMemorySystem {
    constructor() {
        this.memoryStore = new SharedMemoryStore();
        this.contextManager = new ContextManager();
        this.agents = new Map();
    }

    /**
     * Create a memory-enhanced agent
     */
    createAgent(agentId, type) {
        const agent = new MemoryEnhancedAgent(
            agentId,
            type,
            this.memoryStore,
            this.contextManager
        );
        this.agents.set(agentId, agent);
        return agent;
    }

    /**
     * Get or create agent
     */
    getAgent(agentId, type = 'generic') {
        if (!this.agents.has(agentId)) {
            this.createAgent(agentId, type);
        }
        return this.agents.get(agentId);
    }

    /**
     * Facilitate knowledge transfer between agents
     */
    async transferKnowledge(fromAgentId, toAgentId, query) {
        const fromAgent = this.getAgent(fromAgentId);
        const memories = await fromAgent.recall(query);
        
        const toAgent = this.getAgent(toAgentId);
        const transferredIds = [];

        for (const memory of memories.longTerm) {
            const newId = await toAgent.remember(memory.content, memory.type, {
                priority: memory.priority,
                tags: [...(memory.tags || []), 'transferred'],
                transferredFrom: fromAgentId
            });
            transferredIds.push(newId);
        }

        return transferredIds;
    }

    /**
     * Create shared context for collaboration
     */
    createSharedContext(contextId, agentIds, initialData = {}) {
        const context = this.contextManager.createContext(contextId, initialData);
        
        for (const agentId of agentIds) {
            this.contextManager.subscribe(contextId, agentId);
        }

        return context;
    }

    /**
     * Get system-wide statistics
     */
    async getSystemStats() {
        const memoryStats = this.memoryStore.getStatistics();
        const agentStats = [];

        for (const [agentId, agent] of this.agents) {
            agentStats.push(await agent.getMemoryStats());
        }

        return {
            memory: memoryStats,
            agents: agentStats,
            contexts: {
                active: this.contextManager.contexts.size,
                historySize: this.contextManager.contextHistory.length
            },
            knowledgeGraph: {
                nodes: this.memoryStore.knowledgeGraph.nodes.size,
                edges: this.memoryStore.knowledgeGraph.edges.size
            }
        };
    }

    /**
     * Save entire memory system to database
     */
    async saveSystemState() {
        const systemState = {
            memories: Array.from(this.memoryStore.memories.values()),
            contexts: Array.from(this.contextManager.contexts.values()),
            globalContext: this.contextManager.globalContext,
            agents: Array.from(this.agents.keys()),
            timestamp: new Date().toISOString()
        };

        try {
            const { error } = await supabase
                .from('claude_desktop_memory')
                .insert({
                    source: 'memory-system-state',
                    content: JSON.stringify(systemState),
                    metadata: {
                        memory_count: systemState.memories.length,
                        context_count: systemState.contexts.length,
                        agent_count: systemState.agents.length
                    },
                    owner: 'sub-agent-memory-system'
                });

            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error saving system state:', error);
            return false;
        }
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const memorySystem = new SubAgentMemorySystem();

    switch (command) {
        case 'test':
            console.log('Testing memory system...\n');

            // Create agents
            const agent1 = memorySystem.createAgent('agent-1', 'researcher');
            const agent2 = memorySystem.createAgent('agent-2', 'analyzer');

            // Agent 1 learns something
            console.log('Agent 1 learning...');
            await agent1.remember('Found important API endpoint', MEMORY_TYPES.SEMANTIC, {
                priority: PRIORITY_LEVELS.HIGH,
                tags: ['api', 'discovery']
            });

            const learned = await agent1.learn(
                'Tried to call API without authentication',
                'Always include auth headers when calling protected endpoints'
            );
            console.log('Learned:', learned);

            // Agent 1 shares with Agent 2
            console.log('\nAgent 1 sharing knowledge with Agent 2...');
            await agent1.shareKnowledge('agent-2', {
                topic: 'API Authentication',
                details: 'Use Bearer token in Authorization header'
            });

            // Agent 2 recalls
            console.log('\nAgent 2 recalling API-related memories...');
            const recalled = await agent2.recall({ tags: ['api'] });
            console.log('Recalled:', recalled);

            // Create shared context
            console.log('\nCreating shared context...');
            const context = memorySystem.createSharedContext(
                'project-context',
                ['agent-1', 'agent-2'],
                { project: 'API Integration' }
            );
            console.log('Shared context:', context);

            // Get statistics
            console.log('\nSystem Statistics:');
            const stats = await memorySystem.getSystemStats();
            console.log(JSON.stringify(stats, null, 2));

            break;

        case 'semantic-search':
            const query = args.slice(1).join(' ');
            if (!query) {
                console.error('Usage: semantic-search <query>');
                process.exit(1);
            }

            // Create test data
            const testAgent = memorySystem.createAgent('test-agent', 'test');
            await testAgent.remember('JavaScript is a programming language');
            await testAgent.remember('Python is great for data science');
            await testAgent.remember('React is a JavaScript framework');

            const results = await memorySystem.memoryStore.semanticSearch(query);
            console.log('Search results for:', query);
            results.forEach(r => {
                console.log(`- Score: ${r.score.toFixed(2)} | ${JSON.stringify(r.memory.content)}`);
            });
            break;

        case 'knowledge-graph':
            console.log('Building knowledge graph...\n');

            const kgAgent = memorySystem.createAgent('kg-agent', 'builder');
            
            // Create related memories
            await kgAgent.remember('Component A depends on Library X', MEMORY_TYPES.SEMANTIC, {
                tags: ['component', 'dependency']
            });
            await kgAgent.remember('Component B also uses Library X', MEMORY_TYPES.SEMANTIC, {
                tags: ['component', 'dependency']
            });
            await kgAgent.remember('Library X version 2.0 has breaking changes', MEMORY_TYPES.SEMANTIC, {
                tags: ['library', 'version']
            });

            // Get related memories
            const memories = await memorySystem.memoryStore.search({ agentId: 'kg-agent' });
            if (memories.length > 0) {
                const related = memorySystem.memoryStore.knowledgeGraph.getRelatedMemories(memories[0].id);
                console.log('Related memories:', related);
            }

            break;

        case 'save':
            console.log('Saving system state...');
            const saved = await memorySystem.saveSystemState();
            console.log(saved ? 'System state saved successfully' : 'Failed to save system state');
            break;

        default:
            console.log(`
Sub-Agent Memory System

Usage:
  node sub-agent-memory-system.js <command> [options]

Commands:
  test                    Run comprehensive test
  semantic-search <query> Test semantic search
  knowledge-graph        Test knowledge graph
  save                   Save system state to database

Memory Types:
  ${Object.values(MEMORY_TYPES).join(', ')}

Priority Levels:
  ${Object.entries(PRIORITY_LEVELS).map(([k, v]) => `${k}: ${v}`).join(', ')}
            `);
    }
}

// Export for use as module
module.exports = {
    SubAgentMemorySystem,
    SharedMemoryStore,
    ContextManager,
    MemoryEnhancedAgent,
    KnowledgeGraph,
    MEMORY_TYPES,
    PRIORITY_LEVELS
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}