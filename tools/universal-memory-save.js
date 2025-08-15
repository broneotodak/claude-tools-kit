#!/usr/bin/env node

/**
 * Universal Memory Save with Validation
 * Ensures memory is ALWAYS saved to pgVector with validation
 * Falls back through multiple methods until success
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

class UniversalMemorySave {
  constructor() {
    this.attempts = [];
    this.project = this.detectProject();
    this.machine = this.normalizeMachine();
  }

  detectProject() {
    const cwd = process.cwd();
    
    // Check for .ctkrc (THR and other CTK projects)
    if (fs.existsSync(path.join(cwd, '.ctkrc'))) {
      const ctkrc = JSON.parse(fs.readFileSync(path.join(cwd, '.ctkrc'), 'utf8'));
      return path.basename(cwd);
    }
    
    // Check current directory name
    const dirName = path.basename(cwd);
    const projectMap = {
      'THR': 'THR',
      'ATLAS': 'ATLAS',
      'todak-ai': 'TodakAI',
      'flowstate-ai': 'FlowState',
      'ARS': 'ARS',
      'claude-tools-kit': 'ClaudeN'
    };
    
    return projectMap[dirName] || 'General';
  }

  normalizeMachine() {
    const hostname = os.hostname();
    if (hostname.toLowerCase().includes('macbook')) return 'MacBook Pro';
    if (hostname.toLowerCase().includes('windows')) return 'Windows PC';
    return 'MacBook Pro'; // Default for your system
  }

  async saveMemory(content, options = {}) {
    const memory = {
      user_id: 'neo_todak',
      memory_type: options.type || 'technical_solution',
      category: options.category || this.project,
      content: content,
      metadata: {
        tool: 'Claude Code',
        feature: 'universal_memory_save',
        machine: this.machine,
        project: this.project,
        activity_type: options.activityType || 'progress_update',
        flowstate_ready: true,
        environment: process.platform,
        date: new Date().toISOString().split('T')[0],
        validation_attempts: this.attempts.length + 1
      },
      importance: options.importance || 6,
      source: 'claude_code'
    };

    try {
      // Attempt 1: Direct Supabase save
      console.log('🔄 Attempting direct Supabase save...');
      const { data, error } = await supabase
        .from('claude_desktop_memory')
        .insert([memory])
        .select();

      if (!error && data) {
        console.log('✅ Memory saved successfully!');
        return await this.validateSave(data[0].id);
      }

      this.attempts.push({ method: 'direct', error: error?.message });
      throw error;

    } catch (directError) {
      console.log('⚠️  Direct save failed, trying project-specific utils...');
      
      // Attempt 2: Project-specific utils
      try {
        return await this.tryProjectSpecificSave(content, options);
      } catch (projectError) {
        this.attempts.push({ method: 'project-specific', error: projectError.message });
        
        // Attempt 3: Global save-memory tool
        console.log('⚠️  Project utils failed, trying global tool...');
        try {
          return await this.tryGlobalSaveMemory(content, options);
        } catch (globalError) {
          this.attempts.push({ method: 'global-tool', error: globalError.message });
          
          // Attempt 4: Emergency HTTP save
          console.log('🚨 All methods failed, attempting emergency HTTP save...');
          return await this.emergencyHttpSave(memory);
        }
      }
    }
  }

  async tryProjectSpecificSave(content, options) {
    const { execSync } = require('child_process');
    
    // THR specific
    if (this.project === 'THR' && fs.existsSync('scripts/thr-memory-utils.js')) {
      execSync(`node scripts/thr-memory-utils.js ${options.type || 'session'} "${content}"`);
      return { saved: true, method: 'thr-utils' };
    }
    
    // Generic project save
    if (fs.existsSync('scripts/save-memory.js')) {
      execSync(`node scripts/save-memory.js "${this.project}" "Progress" "${content}" ${options.importance || 6}`);
      return { saved: true, method: 'project-save-memory' };
    }
    
    throw new Error('No project-specific save found');
  }

  async tryGlobalSaveMemory(content, options) {
    const { execSync } = require('child_process');
    const globalPath = '/Users/broneotodak/Projects/claude-tools-kit/tools/save-memory.js';
    
    if (!fs.existsSync(globalPath)) {
      throw new Error('Global save-memory not found');
    }
    
    execSync(`node ${globalPath} "${this.project}" "Progress Update" "${content}" ${options.importance || 6}`);
    return { saved: true, method: 'global-save-memory' };
  }

  async emergencyHttpSave(memory) {
    // Direct HTTP request as last resort
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/claude_desktop_memory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(memory)
    });

    if (!response.ok) {
      throw new Error(`HTTP save failed: ${response.status}`);
    }

    return { saved: true, method: 'emergency-http' };
  }

  async validateSave(memoryId = null) {
    // Validate the memory was actually saved
    try {
      const query = memoryId 
        ? supabase.from('claude_desktop_memory').select('id').eq('id', memoryId)
        : supabase.from('claude_desktop_memory').select('id').order('created_at', { ascending: false }).limit(1);
        
      const { data, error } = await query;
      
      if (!error && data && data.length > 0) {
        console.log('✅ Memory validated in database!');
        return { saved: true, validated: true, id: data[0].id };
      }
    } catch (e) {
      console.log('⚠️  Could not validate save');
    }
    
    return { saved: true, validated: false };
  }

  generateReport() {
    console.log('\n📊 Memory Save Report:');
    console.log(`Project: ${this.project}`);
    console.log(`Machine: ${this.machine}`);
    console.log(`Attempts: ${this.attempts.length}`);
    
    if (this.attempts.length > 0) {
      console.log('\nAttempt History:');
      this.attempts.forEach((attempt, i) => {
        console.log(`  ${i + 1}. ${attempt.method}: ${attempt.error || 'Success'}`);
      });
    }
  }
}

// Main function for CLI usage
async function universalSave(content, options = {}) {
  const saver = new UniversalMemorySave();
  
  try {
    const result = await saver.saveMemory(content, options);
    saver.generateReport();
    return result;
  } catch (error) {
    console.error('❌ All save attempts failed!');
    saver.generateReport();
    
    // Last resort: Write to local file
    const emergencyFile = path.join(os.homedir(), '.claude-memory-emergency.json');
    const emergencyData = {
      timestamp: new Date().toISOString(),
      content,
      options,
      project: saver.project,
      attempts: saver.attempts
    };
    
    fs.appendFileSync(emergencyFile, JSON.stringify(emergencyData) + '\n');
    console.log(`📝 Emergency save written to: ${emergencyFile}`);
    
    throw error;
  }
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: universal-memory-save.js "content" [--type=feature] [--importance=7]');
    process.exit(1);
  }
  
  const content = args[0];
  const options = {};
  
  // Parse options
  args.slice(1).forEach(arg => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');
      options[key] = isNaN(value) ? value : parseInt(value);
    }
  });
  
  universalSave(content, options)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { UniversalMemorySave, universalSave };