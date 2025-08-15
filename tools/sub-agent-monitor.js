#!/usr/bin/env node

/**
 * Sub-Agent Monitoring and Debugging System
 * 
 * Features:
 * - Real-time agent monitoring
 * - Performance metrics tracking
 * - Debug logging and tracing
 * - Health checks and alerts
 * - Visual dashboard (CLI-based)
 */

const { createClient } = require('@supabase/supabase-js');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const Table = require('cli-table3');

require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Monitoring Metrics
const METRICS = {
    EXECUTION_TIME: 'execution_time',
    MEMORY_USAGE: 'memory_usage',
    ERROR_RATE: 'error_rate',
    SUCCESS_RATE: 'success_rate',
    THROUGHPUT: 'throughput',
    LATENCY: 'latency',
    QUEUE_SIZE: 'queue_size',
    ACTIVE_AGENTS: 'active_agents'
};

// Alert Severity Levels
const SEVERITY = {
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical'
};

// Performance Monitor
class PerformanceMonitor {
    constructor() {
        this.metrics = new Map();
        this.thresholds = new Map();
        this.alerts = [];
        this.historicalData = new Map();
        this.startTime = Date.now();
    }

    /**
     * Record a metric
     */
    record(metricName, value, metadata = {}) {
        if (!this.metrics.has(metricName)) {
            this.metrics.set(metricName, {
                current: value,
                min: value,
                max: value,
                sum: value,
                count: 1,
                average: value,
                history: []
            });
        } else {
            const metric = this.metrics.get(metricName);
            metric.current = value;
            metric.min = Math.min(metric.min, value);
            metric.max = Math.max(metric.max, value);
            metric.sum += value;
            metric.count++;
            metric.average = metric.sum / metric.count;
            metric.history.push({
                value,
                timestamp: Date.now(),
                metadata
            });

            // Keep only last 1000 data points
            if (metric.history.length > 1000) {
                metric.history.shift();
            }
        }

        // Check thresholds
        this.checkThresholds(metricName, value);
    }

    /**
     * Set threshold for alerts
     */
    setThreshold(metricName, threshold) {
        this.thresholds.set(metricName, threshold);
    }

    /**
     * Check if threshold is exceeded
     */
    checkThresholds(metricName, value) {
        const threshold = this.thresholds.get(metricName);
        if (!threshold) return;

        let alertTriggered = false;
        let severity = SEVERITY.INFO;
        let message = '';

        if (threshold.max && value > threshold.max) {
            alertTriggered = true;
            severity = threshold.severity || SEVERITY.WARNING;
            message = `${metricName} exceeded maximum threshold: ${value} > ${threshold.max}`;
        } else if (threshold.min && value < threshold.min) {
            alertTriggered = true;
            severity = threshold.severity || SEVERITY.WARNING;
            message = `${metricName} below minimum threshold: ${value} < ${threshold.min}`;
        }

        if (alertTriggered) {
            this.createAlert(severity, message, { metric: metricName, value });
        }
    }

    /**
     * Create an alert
     */
    createAlert(severity, message, metadata = {}) {
        const alert = {
            id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            severity,
            message,
            metadata,
            timestamp: new Date().toISOString(),
            acknowledged: false
        };

        this.alerts.push(alert);
        
        // Keep only last 100 alerts
        if (this.alerts.length > 100) {
            this.alerts.shift();
        }

        // Log critical alerts
        if (severity === SEVERITY.CRITICAL) {
            console.error(chalk.red.bold(`[CRITICAL ALERT] ${message}`));
        }

        return alert;
    }

    /**
     * Get current metrics
     */
    getMetrics() {
        const uptime = (Date.now() - this.startTime) / 1000;
        return {
            uptime,
            metrics: Object.fromEntries(this.metrics),
            alerts: this.alerts.filter(a => !a.acknowledged),
            totalAlerts: this.alerts.length
        };
    }

    /**
     * Get metric history
     */
    getHistory(metricName, duration = 3600000) { // Last hour by default
        const metric = this.metrics.get(metricName);
        if (!metric) return [];

        const cutoff = Date.now() - duration;
        return metric.history.filter(h => h.timestamp > cutoff);
    }

    /**
     * Calculate percentiles
     */
    calculatePercentiles(metricName, percentiles = [50, 75, 90, 95, 99]) {
        const metric = this.metrics.get(metricName);
        if (!metric || metric.history.length === 0) return {};

        const values = metric.history.map(h => h.value).sort((a, b) => a - b);
        const result = {};

        for (const p of percentiles) {
            const index = Math.ceil((p / 100) * values.length) - 1;
            result[`p${p}`] = values[Math.max(0, index)];
        }

        return result;
    }
}

// Debug Logger
class DebugLogger {
    constructor(config = {}) {
        this.enabled = config.enabled !== false;
        this.level = config.level || 'info';
        this.outputFile = config.outputFile || null;
        this.maxLogs = config.maxLogs || 10000;
        this.logs = [];
        this.filters = new Set(config.filters || []);
    }

    /**
     * Log levels
     */
    static LEVELS = {
        trace: 0,
        debug: 1,
        info: 2,
        warn: 3,
        error: 4
    };

    /**
     * Log a message
     */
    async log(level, message, metadata = {}) {
        if (!this.enabled) return;
        if (DebugLogger.LEVELS[level] < DebugLogger.LEVELS[this.level]) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            metadata,
            agentId: metadata.agentId || null,
            executionId: metadata.executionId || null
        };

        // Apply filters
        if (this.filters.size > 0) {
            let matchesFilter = false;
            for (const filter of this.filters) {
                if (JSON.stringify(logEntry).includes(filter)) {
                    matchesFilter = true;
                    break;
                }
            }
            if (!matchesFilter) return;
        }

        this.logs.push(logEntry);

        // Maintain log size limit
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        // Write to file if configured
        if (this.outputFile) {
            await this.writeToFile(logEntry);
        }

        // Console output with colors
        this.consoleOutput(logEntry);
    }

    /**
     * Console output with colors
     */
    consoleOutput(logEntry) {
        const colors = {
            trace: chalk.gray,
            debug: chalk.blue,
            info: chalk.green,
            warn: chalk.yellow,
            error: chalk.red
        };

        const color = colors[logEntry.level] || chalk.white;
        const prefix = `[${logEntry.timestamp}] [${logEntry.level.toUpperCase()}]`;
        
        console.log(
            color(prefix),
            logEntry.message,
            logEntry.metadata ? chalk.gray(JSON.stringify(logEntry.metadata)) : ''
        );
    }

    /**
     * Write to file
     */
    async writeToFile(logEntry) {
        try {
            const line = JSON.stringify(logEntry) + '\n';
            await fs.appendFile(this.outputFile, line);
        } catch (error) {
            console.error('Error writing to log file:', error);
        }
    }

    /**
     * Search logs
     */
    search(query) {
        return this.logs.filter(log => {
            const searchStr = JSON.stringify(log).toLowerCase();
            return searchStr.includes(query.toLowerCase());
        });
    }

    /**
     * Get logs by agent
     */
    getAgentLogs(agentId) {
        return this.logs.filter(log => log.agentId === agentId);
    }

    /**
     * Get logs by execution
     */
    getExecutionLogs(executionId) {
        return this.logs.filter(log => log.executionId === executionId);
    }

    /**
     * Clear logs
     */
    clear() {
        this.logs = [];
    }

    // Convenience methods
    trace(message, metadata) { return this.log('trace', message, metadata); }
    debug(message, metadata) { return this.log('debug', message, metadata); }
    info(message, metadata) { return this.log('info', message, metadata); }
    warn(message, metadata) { return this.log('warn', message, metadata); }
    error(message, metadata) { return this.log('error', message, metadata); }
}

// Health Checker
class HealthChecker extends EventEmitter {
    constructor() {
        super();
        this.checks = new Map();
        this.results = new Map();
        this.interval = null;
    }

    /**
     * Register a health check
     */
    registerCheck(name, checkFn, config = {}) {
        this.checks.set(name, {
            name,
            checkFn,
            interval: config.interval || 60000, // 1 minute default
            timeout: config.timeout || 5000,
            critical: config.critical || false,
            lastCheck: null,
            status: 'unknown'
        });
    }

    /**
     * Run a single health check
     */
    async runCheck(name) {
        const check = this.checks.get(name);
        if (!check) return null;

        const startTime = Date.now();
        let result = {
            name,
            status: 'healthy',
            message: 'Check passed',
            duration: 0,
            timestamp: new Date().toISOString()
        };

        try {
            // Run check with timeout
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Health check timeout')), check.timeout)
            );
            
            await Promise.race([check.checkFn(), timeoutPromise]);
            
            result.duration = Date.now() - startTime;
        } catch (error) {
            result.status = 'unhealthy';
            result.message = error.message;
            result.error = error.stack;
            result.duration = Date.now() - startTime;
        }

        check.lastCheck = Date.now();
        check.status = result.status;
        this.results.set(name, result);

        // Emit events
        this.emit('health-check-complete', result);
        if (result.status === 'unhealthy' && check.critical) {
            this.emit('critical-failure', result);
        }

        return result;
    }

    /**
     * Run all health checks
     */
    async runAllChecks() {
        const results = [];
        for (const [name] of this.checks) {
            const result = await this.runCheck(name);
            results.push(result);
        }
        return results;
    }

    /**
     * Start periodic health checks
     */
    start() {
        if (this.interval) return;

        this.interval = setInterval(async () => {
            await this.runAllChecks();
        }, 30000); // Run every 30 seconds

        // Run initial checks
        this.runAllChecks();
    }

    /**
     * Stop periodic health checks
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    /**
     * Get health status
     */
    getStatus() {
        const results = Array.from(this.results.values());
        const healthy = results.filter(r => r.status === 'healthy').length;
        const unhealthy = results.filter(r => r.status === 'unhealthy').length;
        
        let overallStatus = 'healthy';
        if (unhealthy > 0) {
            overallStatus = 'degraded';
            // Check if any critical checks failed
            for (const [name, result] of this.results) {
                const check = this.checks.get(name);
                if (check && check.critical && result.status === 'unhealthy') {
                    overallStatus = 'critical';
                    break;
                }
            }
        }

        return {
            status: overallStatus,
            healthy,
            unhealthy,
            total: results.length,
            checks: results
        };
    }
}

// Monitoring Dashboard
class MonitoringDashboard {
    constructor(performanceMonitor, debugLogger, healthChecker) {
        this.performanceMonitor = performanceMonitor;
        this.debugLogger = debugLogger;
        this.healthChecker = healthChecker;
        this.refreshInterval = null;
    }

    /**
     * Display dashboard
     */
    display() {
        console.clear();
        console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════════'));
        console.log(chalk.cyan.bold('            SUB-AGENT MONITORING DASHBOARD                  '));
        console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════════'));
        console.log();

        this.displayHealthStatus();
        this.displayMetrics();
        this.displayAlerts();
        this.displayAgentStatus();
        this.displayRecentLogs();
    }

    /**
     * Display health status
     */
    displayHealthStatus() {
        const health = this.healthChecker.getStatus();
        const statusColor = {
            healthy: chalk.green,
            degraded: chalk.yellow,
            critical: chalk.red
        }[health.status];

        console.log(chalk.bold('Health Status:'), statusColor(`● ${health.status.toUpperCase()}`));
        console.log(`Checks: ${chalk.green(health.healthy)} healthy, ${chalk.red(health.unhealthy)} unhealthy`);
        console.log();
    }

    /**
     * Display metrics
     */
    displayMetrics() {
        const metrics = this.performanceMonitor.getMetrics();
        
        const table = new Table({
            head: ['Metric', 'Current', 'Average', 'Min', 'Max'],
            colWidths: [25, 15, 15, 15, 15]
        });

        for (const [name, data] of Object.entries(metrics.metrics)) {
            table.push([
                name,
                data.current.toFixed(2),
                data.average.toFixed(2),
                data.min.toFixed(2),
                data.max.toFixed(2)
            ]);
        }

        console.log(chalk.bold('Performance Metrics:'));
        console.log(table.toString());
        console.log();
    }

    /**
     * Display alerts
     */
    displayAlerts() {
        const metrics = this.performanceMonitor.getMetrics();
        const alerts = metrics.alerts;

        if (alerts.length === 0) {
            console.log(chalk.bold('Alerts:'), chalk.green('No active alerts'));
        } else {
            console.log(chalk.bold('Active Alerts:'));
            alerts.slice(0, 5).forEach(alert => {
                const color = {
                    info: chalk.blue,
                    warning: chalk.yellow,
                    error: chalk.red,
                    critical: chalk.red.bold
                }[alert.severity];
                console.log(color(`  [${alert.severity.toUpperCase()}] ${alert.message}`));
            });
        }
        console.log();
    }

    /**
     * Display agent status
     */
    displayAgentStatus() {
        // This would integrate with the actual agent system
        console.log(chalk.bold('Agent Status:'));
        console.log('  Active Agents: 5');
        console.log('  Idle Agents: 3');
        console.log('  Failed Agents: 0');
        console.log();
    }

    /**
     * Display recent logs
     */
    displayRecentLogs() {
        const recentLogs = this.debugLogger.logs.slice(-5);
        
        if (recentLogs.length > 0) {
            console.log(chalk.bold('Recent Logs:'));
            recentLogs.forEach(log => {
                const color = {
                    trace: chalk.gray,
                    debug: chalk.blue,
                    info: chalk.green,
                    warn: chalk.yellow,
                    error: chalk.red
                }[log.level];
                console.log(color(`  [${log.level}] ${log.message}`));
            });
        }
    }

    /**
     * Start auto-refresh
     */
    startAutoRefresh(interval = 5000) {
        this.refreshInterval = setInterval(() => {
            this.display();
        }, interval);
        this.display(); // Initial display
    }

    /**
     * Stop auto-refresh
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
}

// Main Monitoring System
class SubAgentMonitor {
    constructor() {
        this.performanceMonitor = new PerformanceMonitor();
        this.debugLogger = new DebugLogger({ enabled: true, level: 'info' });
        this.healthChecker = new HealthChecker();
        this.dashboard = new MonitoringDashboard(
            this.performanceMonitor,
            this.debugLogger,
            this.healthChecker
        );

        this.setupDefaultHealthChecks();
        this.setupDefaultThresholds();
    }

    /**
     * Setup default health checks
     */
    setupDefaultHealthChecks() {
        // Database connectivity
        this.healthChecker.registerCheck('database', async () => {
            const { error } = await supabase
                .from('claude_desktop_memory')
                .select('count')
                .limit(1);
            if (error) throw error;
        }, { critical: true });

        // Memory usage
        this.healthChecker.registerCheck('memory', async () => {
            const usage = process.memoryUsage();
            if (usage.heapUsed / usage.heapTotal > 0.9) {
                throw new Error('Memory usage above 90%');
            }
        });

        // Agent responsiveness
        this.healthChecker.registerCheck('agent-response', async () => {
            // Simulate agent health check
            await new Promise(resolve => setTimeout(resolve, 100));
        });
    }

    /**
     * Setup default thresholds
     */
    setupDefaultThresholds() {
        this.performanceMonitor.setThreshold(METRICS.EXECUTION_TIME, {
            max: 5000, // 5 seconds
            severity: SEVERITY.WARNING
        });

        this.performanceMonitor.setThreshold(METRICS.ERROR_RATE, {
            max: 0.1, // 10% error rate
            severity: SEVERITY.ERROR
        });

        this.performanceMonitor.setThreshold(METRICS.MEMORY_USAGE, {
            max: 500 * 1024 * 1024, // 500MB
            severity: SEVERITY.WARNING
        });

        this.performanceMonitor.setThreshold(METRICS.QUEUE_SIZE, {
            max: 100,
            severity: SEVERITY.WARNING
        });
    }

    /**
     * Track agent execution
     */
    trackExecution(agentId, executionId, startTime, endTime, success = true) {
        const duration = endTime - startTime;
        
        this.performanceMonitor.record(METRICS.EXECUTION_TIME, duration, {
            agentId,
            executionId,
            success
        });

        if (success) {
            this.performanceMonitor.record(METRICS.SUCCESS_RATE, 1);
            this.debugLogger.info(`Agent ${agentId} completed execution`, {
                agentId,
                executionId,
                duration
            });
        } else {
            this.performanceMonitor.record(METRICS.ERROR_RATE, 1);
            this.debugLogger.error(`Agent ${agentId} failed execution`, {
                agentId,
                executionId,
                duration
            });
        }
    }

    /**
     * Save monitoring data to database
     */
    async saveMonitoringData() {
        const data = {
            metrics: this.performanceMonitor.getMetrics(),
            health: this.healthChecker.getStatus(),
            timestamp: new Date().toISOString()
        };

        try {
            const { error } = await supabase
                .from('claude_desktop_memory')
                .insert({
                    source: 'agent-monitoring',
                    content: JSON.stringify(data),
                    metadata: {
                        type: 'monitoring-snapshot',
                        health_status: data.health.status,
                        alert_count: data.metrics.alerts.length
                    },
                    owner: 'sub-agent-monitor'
                });

            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error saving monitoring data:', error);
            return false;
        }
    }

    /**
     * Export metrics
     */
    exportMetrics(format = 'json') {
        const data = {
            metrics: this.performanceMonitor.getMetrics(),
            health: this.healthChecker.getStatus(),
            logs: this.debugLogger.logs,
            timestamp: new Date().toISOString()
        };

        if (format === 'json') {
            return JSON.stringify(data, null, 2);
        } else if (format === 'csv') {
            // Simple CSV export for metrics
            const metrics = data.metrics.metrics;
            let csv = 'Metric,Current,Average,Min,Max\n';
            for (const [name, values] of Object.entries(metrics)) {
                csv += `${name},${values.current},${values.average},${values.min},${values.max}\n`;
            }
            return csv;
        }

        return data;
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    // Install chalk if not available
    try {
        require('chalk');
    } catch {
        console.log('Installing required dependencies...');
        require('child_process').execSync('npm install chalk cli-table3', { stdio: 'inherit' });
    }

    const monitor = new SubAgentMonitor();

    switch (command) {
        case 'dashboard':
            console.log('Starting monitoring dashboard...');
            monitor.healthChecker.start();
            monitor.dashboard.startAutoRefresh(3000);
            
            // Keep process alive
            process.on('SIGINT', () => {
                monitor.dashboard.stopAutoRefresh();
                monitor.healthChecker.stop();
                process.exit(0);
            });
            break;

        case 'test':
            console.log('Running monitoring test...\n');

            // Simulate agent executions
            for (let i = 0; i < 10; i++) {
                const agentId = `agent-${i % 3}`;
                const executionId = `exec-${i}`;
                const startTime = Date.now();
                const duration = Math.random() * 2000;
                const success = Math.random() > 0.1;
                
                await new Promise(resolve => setTimeout(resolve, duration));
                
                monitor.trackExecution(agentId, executionId, startTime, Date.now(), success);
            }

            // Record some metrics
            monitor.performanceMonitor.record(METRICS.ACTIVE_AGENTS, 5);
            monitor.performanceMonitor.record(METRICS.QUEUE_SIZE, 12);
            monitor.performanceMonitor.record(METRICS.MEMORY_USAGE, process.memoryUsage().heapUsed);

            // Run health checks
            await monitor.healthChecker.runAllChecks();

            // Display results
            console.log('Metrics:', JSON.stringify(monitor.performanceMonitor.getMetrics(), null, 2));
            console.log('\nHealth Status:', JSON.stringify(monitor.healthChecker.getStatus(), null, 2));
            
            break;

        case 'export':
            const format = args[1] || 'json';
            const exported = monitor.exportMetrics(format);
            console.log(exported);
            break;

        case 'save':
            console.log('Saving monitoring data...');
            const saved = await monitor.saveMonitoringData();
            console.log(saved ? 'Monitoring data saved' : 'Failed to save monitoring data');
            break;

        default:
            console.log(`
Sub-Agent Monitoring System

Usage:
  node sub-agent-monitor.js <command> [options]

Commands:
  dashboard       Start interactive monitoring dashboard
  test           Run monitoring test with simulated data
  export [format] Export metrics (json or csv)
  save           Save monitoring data to database

Metrics:
  ${Object.values(METRICS).join(', ')}

Severity Levels:
  ${Object.values(SEVERITY).join(', ')}
            `);
    }
}

// Export for use as module
module.exports = {
    SubAgentMonitor,
    PerformanceMonitor,
    DebugLogger,
    HealthChecker,
    MonitoringDashboard,
    METRICS,
    SEVERITY
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}