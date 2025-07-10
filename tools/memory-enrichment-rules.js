/**
 * Memory Enrichment Rules
 * Centralized rules for processing memories from different machines and tools
 */

// Project detection rules
const PROJECT_RULES = [
  // Exact matches
  { pattern: /flowstate-ai/i, project: 'FlowState' },
  { pattern: /claude-tools-kit|ctk/i, project: 'CTK' },
  { pattern: /neo-progress-bridge|npb/i, project: 'Neo-Progress-Bridge' },
  { pattern: /todak-ai/i, project: 'TODAK AI' },
  { pattern: /firasah/i, project: 'Firasah' },
  { pattern: /atlas/i, project: 'ATLAS' },
  { pattern: /thr|hrms/i, project: 'THR' },
  
  // Path-based detection
  { pattern: /\/Projects\/([^\/]+)/, extractGroup: 1 },
  { pattern: /working on ([a-zA-Z0-9-_]+) project/i, extractGroup: 1 },
  
  // Language/framework specific
  { pattern: /package\.json.*"name":\s*"([^"]+)"/s, extractGroup: 1 },
  { pattern: /cargo\.toml.*name\s*=\s*"([^"]+)"/si, extractGroup: 1 },
];

// Machine normalization rules
const MACHINE_RULES = [
  { pattern: /macbook|mac\b/i, normalized: 'MacBook Pro' },
  { pattern: /windows|pc|desktop/i, normalized: 'Windows PC' },
  { pattern: /linux|ubuntu|debian/i, normalized: 'Linux Machine' },
  { pattern: /wsl/i, normalized: 'WSL Ubuntu' },
  { pattern: /office.*pc/i, normalized: 'Office PC' },
  { pattern: /home.*pc/i, normalized: 'Home PC' },
];

// Activity type detection rules
const ACTIVITY_RULES = [
  // Git activities
  { pattern: /git commit|committed/i, type: 'git_commit' },
  { pattern: /git push|pushed to/i, type: 'git_push' },
  { pattern: /pull request|PR\s|merge/i, type: 'github_activity' },
  
  // Development activities
  { pattern: /fixed bug|bug fix|fixing/i, type: 'bug_fix' },
  { pattern: /implemented|created|added feature/i, type: 'feature' },
  { pattern: /refactor|cleanup|optimize/i, type: 'refactoring' },
  { pattern: /test|testing|wrote test/i, type: 'testing' },
  { pattern: /deploy|deployment|released/i, type: 'deployment' },
  
  // Documentation
  { pattern: /document|readme|docs/i, type: 'documentation' },
  
  // Tool-specific patterns
  { pattern: /cursor.*ai|copilot/i, type: 'ai_assisted_coding' },
  { pattern: /npm install|pip install|cargo/i, type: 'dependency_management' },
  { pattern: /docker|container|kubernetes/i, type: 'devops' },
];

// Tool identification rules
const TOOL_RULES = [
  { pattern: /claude\s*code/i, tool: 'Claude Code' },
  { pattern: /cursor/i, tool: 'Cursor' },
  { pattern: /vs\s*code|vscode/i, tool: 'VS Code' },
  { pattern: /intellij|idea/i, tool: 'IntelliJ' },
  { pattern: /terminal|bash|zsh/i, tool: 'Terminal' },
  { pattern: /chrome|firefox|safari|edge/i, tool: 'Browser' },
];

/**
 * Apply enrichment rules to a memory
 */
function applyEnrichmentRules(memory) {
  const content = (memory.content || '').toLowerCase();
  const metadata = memory.metadata || {};
  
  // Extract project
  let project = metadata.project;
  if (!project) {
    for (const rule of PROJECT_RULES) {
      const match = content.match(rule.pattern);
      if (match) {
        project = rule.extractGroup ? match[rule.extractGroup] : rule.project;
        break;
      }
    }
  }
  
  // Normalize machine
  let machine = metadata.machine || 'Unknown';
  for (const rule of MACHINE_RULES) {
    if (rule.pattern.test(machine)) {
      machine = rule.normalized;
      break;
    }
  }
  
  // Detect activity type
  let activityType = metadata.activity_type || memory.memory_type || 'note';
  for (const rule of ACTIVITY_RULES) {
    if (rule.pattern.test(content)) {
      activityType = rule.type;
      break;
    }
  }
  
  // Identify tool
  let tool = metadata.tool || memory.tool;
  if (!tool) {
    for (const rule of TOOL_RULES) {
      if (rule.pattern.test(content)) {
        tool = rule.tool;
        break;
      }
    }
  }
  
  return {
    ...metadata,
    project: project || memory.category || 'General',
    machine: machine,
    activity_type: activityType,
    tool: tool || 'Unknown Tool',
    enriched_at: new Date().toISOString()
  };
}

module.exports = {
  PROJECT_RULES,
  MACHINE_RULES,
  ACTIVITY_RULES,
  TOOL_RULES,
  applyEnrichmentRules
};