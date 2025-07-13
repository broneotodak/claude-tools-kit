/**
 * Standardized memory types and categories for Claude Code
 */

const MEMORY_TYPES = {
    TECHNICAL_SOLUTION: 'technical_solution',
    CODE_REVIEW: 'code_review',
    ARCHITECTURE: 'architecture_decision',
    BUG_FIX: 'bug_fix',
    FEATURE: 'feature_implementation',
    RESEARCH: 'research_findings',
    DEPLOYMENT: 'deployment_record',
    SYSTEM_CONFIG: 'system_configuration',
    MEETING: 'meeting_notes',
    TASK: 'task_tracking'
};

const MEMORY_CATEGORIES = {
    CLAUDEN: 'ClaudeN',
    THR: 'THR',
    ATLAS: 'ATLAS',
    TODAK_AI: 'TodakAI',
    FLOWSTATE: 'FlowState',
    FIRASAH: 'Firasah',
    KENAL: 'Kenal',
    N8N: 'n8n',
    VENTURE_CANVAS: 'VentureCanvas',
    GENERAL: 'General'
};

const IMPORTANCE_LEVELS = {
    CRITICAL: 8,
    HIGH: 6,
    MEDIUM: 4,
    LOW: 2,
    INFO: 1
};

module.exports = {
    MEMORY_TYPES,
    MEMORY_CATEGORIES,
    IMPORTANCE_LEVELS
};