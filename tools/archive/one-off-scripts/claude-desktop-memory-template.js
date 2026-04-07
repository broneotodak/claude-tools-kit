// Claude Desktop Memory Template
// Copy this template when saving memories to Supabase

const memoryTemplate = {
  // Required fields
  user_id: 'neo_todak',
  memory_type: 'technical_solution', // Change based on type
  category: 'Project Name',          // e.g., 'TODAK AI', 'FlowState', 'CTK'
  title: 'Short descriptive title',
  content: 'Full content of what was discussed or implemented...',
  
  // Critical metadata for FlowState display
  metadata: {
    machine: require('os').hostname(), // Gets actual machine name
    tool: 'Claude Desktop',           // Always use this for Claude Desktop
    project: 'Project Name',          // Same as category
    date: new Date().toISOString().split('T')[0],
    environment: process.platform,    // 'darwin', 'win32', 'linux'
    actual_source: 'claude_desktop'
  },
  
  importance: 5, // 1-10 scale
  
  // Auto-filled by Supabase
  // created_at: auto
  // updated_at: auto
};

// Example for TODAK AI planning session
const exampleMemory = {
  user_id: 'neo_todak',
  memory_type: 'planning',
  category: 'TODAK AI',
  title: 'TODAK Sofia Workflow Planning Session',
  content: `15-point comprehensive plan outlined:
1) WhatsApp webhook with Twilio integration
2) Message processing and user identification
3) Context management for conversations
4) AI response generation with GPT-4
5) Media handling for images/documents
6) Error handling and fallback responses
7) Admin dashboard for monitoring
8) User preference management
9) Multi-language support
10) Analytics and reporting
11) Rate limiting and abuse prevention
12) Backup and recovery procedures
13) Security and encryption
14) Performance optimization
15) Deployment and scaling strategy`,
  metadata: {
    machine: require('os').hostname(),
    tool: 'Claude Desktop',
    project: 'TODAK AI',
    feature: 'sofia_whatsapp_bot',
    date: new Date().toISOString().split('T')[0],
    environment: process.platform,
    actual_source: 'claude_desktop',
    tags: ['whatsapp', 'bot', 'planning', 'architecture']
  },
  importance: 8
};

// Memory type guide:
const MEMORY_TYPES = {
  'technical_solution': 'Code implementations, technical solutions',
  'bug_fix': 'Bug fixes and issue resolutions',
  'feature': 'New features or enhancements',
  'planning': 'Planning sessions, architecture decisions',
  'research': 'Research findings, investigations',
  'note': 'General notes or observations',
  'todo': 'Tasks to be completed',
  'learning': 'Learning notes, new discoveries',
  'code_review': 'Code review findings',
  'documentation': 'Documentation updates',
  'meeting': 'Meeting notes and decisions'
};

// Quick function to create properly formatted memory
function createMemory(type, category, title, content, importance = 5) {
  return {
    user_id: 'neo_todak',
    memory_type: type,
    category: category,
    title: title,
    content: content,
    metadata: {
      machine: require('os').hostname(),
      tool: 'Claude Desktop',
      project: category,
      date: new Date().toISOString().split('T')[0],
      environment: process.platform,
      actual_source: 'claude_desktop'
    },
    importance: importance
  };
}

// Export for use
module.exports = { memoryTemplate, createMemory, MEMORY_TYPES };