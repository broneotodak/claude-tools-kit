#!/usr/bin/env node

/**
 * Claude Code Memory Enforcement Hook
 * Ensures ALL "save progress" requests go to pgVector memory
 * 
 * This hook intercepts common save phrases and enforces proper memory saving
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Common phrases that indicate save request
const SAVE_TRIGGERS = [
  'save our progress',
  'save progress',
  'save this',
  'document this',
  'log this',
  'record this',
  'save to memory',
  'save the session',
  'save what we did',
  'save our work'
];

// Detect current project
function detectProject() {
  const cwd = process.cwd();
  
  // Check for project-specific markers
  if (cwd.includes('THR') || fs.existsSync(path.join(cwd, '.ctkrc'))) {
    return { name: 'THR', path: cwd };
  }
  
  if (cwd.includes('ATLAS')) {
    return { name: 'ATLAS', path: cwd };
  }
  
  if (cwd.includes('todak-ai')) {
    return { name: 'TodakAI', path: cwd };
  }
  
  // Check parent directories
  const parentDir = path.dirname(cwd);
  const projectName = path.basename(parentDir);
  
  return { name: projectName || 'General', path: cwd };
}

// Find appropriate memory save command
function getMemorySaveCommand(project, content) {
  const projectPath = project.path;
  
  // Check for project-specific memory utils
  const thrMemoryUtils = path.join(projectPath, 'scripts/thr-memory-utils.js');
  if (fs.existsSync(thrMemoryUtils) && project.name === 'THR') {
    return {
      command: 'node scripts/thr-memory-utils.js session',
      args: [`"${content}"`],
      cwd: projectPath
    };
  }
  
  // Check for local save-memory in project
  const localSaveMemory = path.join(projectPath, 'scripts/save-memory.js');
  if (fs.existsSync(localSaveMemory)) {
    return {
      command: 'node scripts/save-memory.js',
      args: [project.name, 'Progress Update', `"${content}"`, '6'],
      cwd: projectPath
    };
  }
  
  // Fallback to global claude-tools-kit
  const globalSaveMemory = '/Users/broneotodak/Projects/claude-tools-kit/tools/save-memory.js';
  if (fs.existsSync(globalSaveMemory)) {
    return {
      command: `node ${globalSaveMemory}`,
      args: [project.name, 'Progress Update', `"${content}"`, '6'],
      cwd: process.cwd()
    };
  }
  
  throw new Error('No memory save utility found!');
}

// Validate memory was saved
async function validateMemorySaved(timestamp) {
  // This would check Supabase to confirm save
  // For now, we check the command succeeded
  return true;
}

// Main enforcement function
async function enforceMemorySave(userInput, context = {}) {
  try {
    // Check if this is a save request
    const isSaveRequest = SAVE_TRIGGERS.some(trigger => 
      userInput.toLowerCase().includes(trigger)
    );
    
    if (!isSaveRequest) {
      return { enforced: false };
    }
    
    console.log('🧠 Memory Save Enforcement Triggered');
    
    // Detect project
    const project = detectProject();
    console.log(`📁 Detected project: ${project.name}`);
    
    // Determine what to save
    const content = context.summary || context.lastAction || userInput;
    
    // Get appropriate command
    const saveCmd = getMemorySaveCommand(project, content);
    console.log(`💾 Using command: ${saveCmd.command}`);
    
    // Execute save
    const fullCommand = `${saveCmd.command} ${saveCmd.args.join(' ')}`;
    execSync(fullCommand, { 
      cwd: saveCmd.cwd,
      stdio: 'inherit'
    });
    
    // Validate
    const saved = await validateMemorySaved(new Date());
    
    if (saved) {
      console.log('✅ Memory saved successfully to pgVector!');
      return {
        enforced: true,
        project: project.name,
        command: fullCommand
      };
    }
    
  } catch (error) {
    console.error('❌ Memory enforcement failed:', error.message);
    
    // Fallback: Try global save-memory directly
    try {
      const fallbackCmd = `node /Users/broneotodak/Projects/claude-tools-kit/tools/save-memory.js General "Fallback Save" "${userInput}" 5`;
      execSync(fallbackCmd);
      console.log('✅ Fallback save completed');
      return { enforced: true, fallback: true };
    } catch (fallbackError) {
      console.error('❌ Fallback also failed:', fallbackError.message);
      return { enforced: false, error: error.message };
    }
  }
}

// Export for use in Claude Code
module.exports = {
  enforceMemorySave,
  detectProject,
  SAVE_TRIGGERS
};

// CLI usage
if (require.main === module) {
  const input = process.argv.slice(2).join(' ');
  if (input) {
    enforceMemorySave(input).then(result => {
      console.log('Result:', result);
    });
  } else {
    console.log('Usage: enforce-memory-save.js "save our progress"');
  }
}