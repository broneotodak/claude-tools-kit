#!/usr/bin/env node

/**
 * Metrics Recording
 * Tracks execution metrics and provides CrewAI-style summaries
 */

import fs from 'fs';
import path from 'path';

function getRunHistoryDir() {
  const baseDir = process.env.CTK_ROOT || process.cwd();
  const historyDir = path.join(baseDir, 'run_history');
  
  // Ensure directory exists
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }
  
  return historyDir;
}

export function recordMetrics(runId, role, stats) {
  const {
    elapsedMs = 0,
    tokensIn = 0,
    tokensOut = 0,
    toolCalls = 0,
    ok = true,
    retries = 0,
    gate = null
  } = stats;
  
  const metric = {
    runId,
    timestamp: new Date().toISOString(),
    project: process.env.CTK_PROJECT || 'default',
    role,
    elapsedMs,
    tokensIn,
    tokensOut,
    toolCalls,
    ok,
    retries,
    gate
  };
  
  // Save to JSON file
  const historyDir = getRunHistoryDir();
  const jsonFile = path.join(historyDir, `${runId}.json`);
  
  let history = [];
  if (fs.existsSync(jsonFile)) {
    const content = fs.readFileSync(jsonFile, 'utf8');
    history = JSON.parse(content);
  }
  
  history.push(metric);
  fs.writeFileSync(jsonFile, JSON.stringify(history, null, 2));
  
  // Also append to CSV
  const csvFile = path.join(historyDir, 'metrics.csv');
  const csvHeaders = 'runId,timestamp,project,role,elapsedMs,tokensIn,tokensOut,toolCalls,ok,retries,gate\n';
  
  if (!fs.existsSync(csvFile)) {
    fs.writeFileSync(csvFile, csvHeaders);
  }
  
  const csvLine = `${runId},${metric.timestamp},${metric.project},${role},${elapsedMs},${tokensIn},${tokensOut},${toolCalls},${ok},${retries},${gate || ''}\n`;
  fs.appendFileSync(csvFile, csvLine);
  
  // Print CrewAI-style summary line
  const seconds = (elapsedMs / 1000).toFixed(1);
  const tokens = tokensIn + tokensOut;
  console.log(`● ${role} └─ Done (${toolCalls} tool uses · ${tokens} tokens · ${seconds}s)`);
  
  return metric;
}

export function generateRunId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `run_${timestamp}_${random}`;
}

export function printFinalSummary(runId) {
  const historyDir = getRunHistoryDir();
  const jsonFile = path.join(historyDir, `${runId}.json`);
  
  if (!fs.existsSync(jsonFile)) {
    console.log('No metrics found for run:', runId);
    return;
  }
  
  const content = fs.readFileSync(jsonFile, 'utf8');
  const metrics = JSON.parse(content);
  
  // Calculate totals
  const totalTools = metrics.reduce((sum, m) => sum + m.toolCalls, 0);
  const totalTokens = metrics.reduce((sum, m) => sum + m.tokensIn + m.tokensOut, 0);
  const totalMs = metrics.reduce((sum, m) => sum + m.elapsedMs, 0);
  const totalSeconds = (totalMs / 1000).toFixed(1);
  
  console.log('\n' + '─'.repeat(50));
  console.log(`✓ Orchestration complete: ${metrics.length} agents executed`);
  console.log(`  Total: ${totalTools} tool uses · ${totalTokens} tokens · ${totalSeconds}s`);
  console.log('─'.repeat(50));
}

export default { recordMetrics, generateRunId, printFinalSummary };