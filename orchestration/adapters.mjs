#!/usr/bin/env node

/**
 * Tool Adapters
 * Normalized wrappers for different tool types
 * Returns: { artifacts:any, tokensIn:number, tokensOut:number, toolCalls:number }
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { withLLMMetrics, parseStdioMetrics } from './token_wrapper.mjs';

/**
 * Try to import a module; returns null if fails
 */
async function importIfPossible(toolPath) {
  try {
    // Convert to file:// URL for dynamic import
    const fileUrl = `file://${path.resolve(toolPath)}`;
    const module = await import(fileUrl);
    return module;
  } catch (error) {
    // Module can't be imported (not ESM, syntax error, etc.)
    return null;
  }
}

/**
 * Run a script as child process with timeout
 */
function runScript(toolPath, args = [], env = {}, options = {}) {
  return new Promise((resolve) => {
    const timeout = options.timeout || parseInt(process.env.CTK_TOOL_TIMEOUT_MS || '120000');
    const cwd = options.cwd || path.dirname(toolPath);
    
    // Check if the original path is a symlink first
    const origStat = fs.lstatSync(toolPath);
    if (origStat.isSymbolicLink()) {
      return resolve({ exitCode: 1, stdout: '', stderr: 'Refused symlink/non-file tool' });
    }
    
    const real = fs.realpathSync(toolPath);
    const st = fs.statSync(real);
    if (!st.isFile()) {
      return resolve({ exitCode: 1, stdout: '', stderr: 'Refused symlink/non-file tool' });
    }
    const isExecutable = (st.mode & 0o111) !== 0;
    const ext = path.extname(real);
    
    let command, cmdArgs;
    
    if (isExecutable && !ext.match(/\.(js|mjs|cjs)$/)) {
      // Shell script or executable
      command = '/bin/bash';
      cmdArgs = [toolPath, ...args];
    } else if (ext.match(/\.(js|mjs|cjs)$/)) {
      // JavaScript file
      command = 'node';
      cmdArgs = [toolPath, ...args];
    } else {
      // Default to bash
      command = '/bin/bash';
      cmdArgs = [toolPath, ...args];
    }
    
    const SAFE_ENV_KEYS = ['PATH','HOME','SHELL','CTK_RUN_ID','CTK_PROJECT','CTK_STRICT_MODE'];
    const defaultPath = '/usr/local/bin:/usr/bin:/bin';
    const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => SAFE_ENV_KEYS.includes(k)));
    const child = spawn(command, cmdArgs, {
      env: { PATH: defaultPath, ...baseEnv, ...env },
      cwd
    });
    
    let stdout = '';
    let stderr = '';
    let killed = false;
    
    // Set up timeout
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000); // Force kill after 5s if still running
    }, timeout);
    
    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      // Lower cap to reduce data exposure
      if (stdout.length < 100000) { // 100 KB cap
        stdout += chunk;
      }
    });
    
    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      if (stderr.length < 50000) { // 50 KB cap for errors
        stderr += chunk;
      }
    });
    
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (killed) {
        resolve({ exitCode: 124, stdout, stderr: stderr + '\n[TIMEOUT]' });
      } else {
        resolve({ exitCode: exitCode || 0, stdout, stderr });
      }
    });
    
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout: '', stderr: error.message });
    });
  });
}

/**
 * Wrap a module function call with optional LLM metrics
 */
function wrapModule(fn, label) {
  return async (...args) => {
    try {
      let result, tokensIn = 0, tokensOut = 0, costEst = 0;
      
      if (process.env.CTK_LLM_WRAP === '1') {
        // Wrap with LLM metrics
        const metricsResult = await withLLMMetrics(label, async () => fn(...args));
        result = metricsResult.result;
        tokensIn = metricsResult.tokensIn;
        tokensOut = metricsResult.tokensOut;
        costEst = metricsResult.costEst;
      } else {
        // Direct call
        result = await fn(...args);
      }
      
      return {
        artifacts: result || { completed: true },
        tokensIn,
        tokensOut,
        toolCalls: 1
      };
    } catch (error) {
      return {
        artifacts: { error: error.message, ok: false },
        tokensIn: 0,
        tokensOut: 0,
        toolCalls: 1
      };
    }
  };
}

/**
 * Wrap exit code as artifacts
 */
function wrapExitCode(label) {
  return (result) => ({
    artifacts: { 
      ok: result.exitCode === 0, 
      exitCode: result.exitCode,
      label 
    },
    tokensIn: 0,
    tokensOut: 0,
    toolCalls: 1
  });
}

/**
 * Wrap stdout as JSON or raw with token metrics
 */
function wrapStdoutJson(label) {
  return (result) => {
    let artifacts;
    try {
      artifacts = JSON.parse(result.stdout);
    } catch {
      // Never propagate raw stdout; provide a redacted preview + size only
      const out = result.stdout || '';
      const preview = out.slice(0, 512);
      artifacts = {
        exitCode: result.exitCode,
        stdout_preview: preview,
        stdout_bytes: Buffer.byteLength(out, 'utf8'),
        redacted: true
      };
    }
    
    // Null-safe aggregation for metrics parsing
    const metrics = parseStdioMetrics((result.stdout || '') + '\n' + (result.stderr || ''));
    
    return {
      artifacts,
      tokensIn: metrics.tokensIn,
      tokensOut: metrics.tokensOut,
      toolCalls: 1
    };
  };
}

/**
 * Set strict mode for THR context
 */
export function guardStrictMode() {
  const isTHR = process.cwd().includes('/Projects/THR') || process.env.CTK_PROJECT === 'THR';
  if (isTHR) {
    process.env.CTK_STRICT_MODE = '1';
  }
  return process.env.CTK_STRICT_MODE === '1';
}

/**
 * Memory adapter
 */
export async function memoryAdapter(toolPath, baton = {}) {
  guardStrictMode();
  
  const module = await importIfPossible(toolPath);
  
  if (module) {
    // Try to call exported function
    const fn = module.default || module.saveMemory || module.save;
    if (typeof fn === 'function') {
      const wrapper = wrapModule(fn, 'memory');
      return await wrapper(baton);
    }
  }
  
  // Fall back to script execution
  const result = await runScript(toolPath, [], { CTK_STRICT_MODE: process.env.CTK_STRICT_MODE });
  return {
    artifacts: { saved: result.exitCode === 0 },
    tokensIn: 0,
    tokensOut: 0,
    toolCalls: 1
  };
}

/**
 * SQL adapter
 */
export async function sqlAdapter(toolPath, baton = {}) {
  guardStrictMode();
  
  const module = await importIfPossible(toolPath);
  
  if (module) {
    const fn = module.default || module.runMigration || module.execute;
    if (typeof fn === 'function') {
      try {
        const result = await fn(baton);
        return {
          artifacts: { ...result, success: result.success !== false },
          tokensIn: 0,
          tokensOut: 0,
          toolCalls: 1
        };
      } catch (error) {
        return {
          artifacts: { success: false, error: error.message },
          tokensIn: 0,
          tokensOut: 0,
          toolCalls: 1
        };
      }
    }
  }
  
  // Fall back to script execution
  const result = await runScript(toolPath, [], { CTK_STRICT_MODE: process.env.CTK_STRICT_MODE });
  const wrapper = wrapStdoutJson('sql');
  const normalized = wrapper(result);
  normalized.artifacts.success = result.exitCode === 0;
  return normalized;
}

/**
 * Validation adapter
 */
export async function validationAdapter(toolPath, baton = {}) {
  guardStrictMode();
  
  const module = await importIfPossible(toolPath);
  
  if (module) {
    const fn = module.default || module.validate || module.check;
    if (typeof fn === 'function') {
      try {
        const result = await fn(baton);
        return {
          artifacts: { 
            issues: result.issues || [],
            ok: result.ok !== false
          },
          tokensIn: 0,
          tokensOut: 0,
          toolCalls: 1
        };
      } catch (error) {
        return {
          artifacts: { issues: [error.message], ok: false },
          tokensIn: 0,
          tokensOut: 0,
          toolCalls: 1
        };
      }
    }
  }
  
  // Fall back to script execution
  const result = await runScript(toolPath, [], { CTK_STRICT_MODE: process.env.CTK_STRICT_MODE });
  return {
    artifacts: {
      issues: result.stderr ? [result.stderr] : [],
      ok: result.exitCode === 0
    },
    tokensIn: 0,
    tokensOut: 0,
    toolCalls: 1
  };
}

/**
 * QA adapter
 */
export async function qaAdapter(toolPath, baton = {}) {
  guardStrictMode();
  
  const module = await importIfPossible(toolPath);
  
  if (module) {
    const fn = module.default || module.runTests || module.test;
    if (typeof fn === 'function') {
      try {
        const result = await fn(baton);
        return {
          artifacts: { 
            testsPassed: result.testsPassed === true || result.passed === true || result.ok === true
          },
          tokensIn: 0,
          tokensOut: 0,
          toolCalls: 1
        };
      } catch (error) {
        return {
          artifacts: { testsPassed: false, error: error.message },
          tokensIn: 0,
          tokensOut: 0,
          toolCalls: 1
        };
      }
    }
  }
  
  // Fall back to script execution - test runners typically use exit code
  const result = await runScript(toolPath, [], { CTK_STRICT_MODE: process.env.CTK_STRICT_MODE });
  return {
    artifacts: { testsPassed: result.exitCode === 0 },
    tokensIn: 0,
    tokensOut: 0,
    toolCalls: 1
  };
}

/**
 * Security adapter
 */
export async function securityAdapter(toolPath, baton = {}) {
  guardStrictMode();
  
  // Pre-commit hooks are typically shell scripts
  const result = await runScript(toolPath, [], { CTK_STRICT_MODE: process.env.CTK_STRICT_MODE });
  
  return {
    artifacts: { 
      audit: true,
      ok: result.exitCode === 0 
    },
    tokensIn: 0,
    tokensOut: 0,
    toolCalls: 1
  };
}

export default {
  importIfPossible,
  runScript,
  wrapModule,
  wrapExitCode,
  wrapStdoutJson,
  guardStrictMode,
  memoryAdapter,
  sqlAdapter,
  validationAdapter,
  qaAdapter,
  securityAdapter
};