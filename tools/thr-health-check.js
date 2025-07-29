#!/usr/bin/env node

/**
 * THR Comprehensive Health Check Tool
 * Part of CTK (Claude Tools Kit)
 * 
 * This tool performs automated testing of THR application:
 * - Tests all routes/pages
 * - Captures console errors
 * - Tests interactive elements
 * - Saves results to memory
 */

const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Configuration
const THR_URL = process.env.THR_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Test routes
const TEST_ROUTES = [
  { path: '/login', name: 'Login Page', requiresAuth: false },
  { path: '/dashboard', name: 'Dashboard', requiresAuth: true },
  { path: '/employees', name: 'Employee Directory', requiresAuth: true },
  { path: '/organizations', name: 'Organizations', requiresAuth: true },
  { path: '/profile', name: 'Profile', requiresAuth: true },
  { path: '/claims', name: 'Claims', requiresAuth: true },
  { path: '/leave', name: 'Leave Management', requiresAuth: true },
  { path: '/payroll', name: 'Payroll', requiresAuth: true },
  { path: '/admin', name: 'Admin Settings', requiresAuth: true, minAccessLevel: 7 }
];

// Interactive elements to test
const INTERACTIVE_TESTS = [
  {
    page: '/dashboard',
    tests: [
      { selector: '[data-testid="organization-card"]', action: 'click', name: 'Organization Dialog' },
      { selector: '[data-testid="dark-mode-toggle"]', action: 'click', name: 'Dark Mode Toggle' },
      { selector: '[data-testid="notification-bell"]', action: 'click', name: 'Notifications' }
    ]
  },
  {
    page: '/employees',
    tests: [
      { selector: '[data-testid="employee-card"]', action: 'click', name: 'Employee Profile Dialog' },
      { selector: '[data-testid="search-input"]', action: 'type', value: 'Ahmad', name: 'Employee Search' },
      { selector: '[data-testid="filter-button"]', action: 'click', name: 'Filter Options' }
    ]
  }
];

class THRHealthCheck {
  constructor() {
    this.browser = null;
    this.page = null;
    this.results = {
      timestamp: new Date().toISOString(),
      url: THR_URL,
      routes: [],
      interactions: [],
      consoleErrors: [],
      networkErrors: [],
      performanceMetrics: {},
      summary: {
        totalTests: 0,
        passed: 0,
        failed: 0,
        warnings: 0
      }
    };
  }

  async init() {
    console.log('🚀 Starting THR Health Check...\n');
    console.log(`URL: ${THR_URL}`);
    console.log(`Time: ${this.results.timestamp}`);
    console.log('='.repeat(80));

    this.browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    this.page = await this.browser.newPage();
    
    // Set viewport
    await this.page.setViewport({ width: 1920, height: 1080 });

    // Setup error capturing
    this.setupErrorCapture();

    // Login first
    await this.login();
  }

  setupErrorCapture() {
    // Capture console errors
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        this.results.consoleErrors.push({
          text: msg.text(),
          location: msg.location(),
          timestamp: new Date().toISOString()
        });
      }
    });

    // Capture page errors
    this.page.on('pageerror', error => {
      this.results.consoleErrors.push({
        text: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    });

    // Capture failed requests
    this.page.on('requestfailed', request => {
      this.results.networkErrors.push({
        url: request.url(),
        method: request.method(),
        error: request.failure().errorText,
        timestamp: new Date().toISOString()
      });
    });
  }

  async login() {
    console.log('\n📝 Logging in...');
    
    try {
      await this.page.goto(`${THR_URL}/login`, { waitUntil: 'networkidle2' });
      
      // MVP bypass login for neo@todak.com
      await this.page.type('[name="email"]', 'neo@todak.com');
      await this.page.type('[name="password"]', 'test123'); // This will use MVP bypass
      
      await Promise.all([
        this.page.click('[type="submit"]'),
        this.page.waitForNavigation({ waitUntil: 'networkidle2' })
      ]);
      
      console.log('✅ Login successful');
    } catch (error) {
      console.log('❌ Login failed:', error.message);
      throw error;
    }
  }

  async testRoutes() {
    console.log('\n🔍 Testing Routes:');
    console.log('-'.repeat(40));

    for (const route of TEST_ROUTES) {
      const testResult = {
        ...route,
        status: 'pending',
        loadTime: 0,
        errors: [],
        warnings: []
      };

      try {
        console.log(`\nTesting: ${route.name} (${route.path})`);
        
        const startTime = Date.now();
        const response = await this.page.goto(`${THR_URL}${route.path}`, { 
          waitUntil: 'networkidle2',
          timeout: 30000 
        });
        const loadTime = Date.now() - startTime;
        
        testResult.loadTime = loadTime;
        testResult.statusCode = response.status();

        // Check for success
        if (response.status() >= 200 && response.status() < 300) {
          testResult.status = 'passed';
          console.log(`  ✅ Loaded successfully (${loadTime}ms)`);
          
          // Check for slow load times
          if (loadTime > 2000) {
            testResult.warnings.push(`Slow load time: ${loadTime}ms`);
            console.log(`  ⚠️  Warning: Slow load time`);
          }
        } else {
          testResult.status = 'failed';
          testResult.errors.push(`HTTP ${response.status()}`);
          console.log(`  ❌ Failed with status ${response.status()}`);
        }

        // Take screenshot for failed tests
        if (testResult.status === 'failed') {
          const screenshotPath = `/tmp/thr-error-${route.path.replace(/\//g, '-')}.png`;
          await this.page.screenshot({ path: screenshotPath, fullPage: true });
          testResult.screenshot = screenshotPath;
        }

      } catch (error) {
        testResult.status = 'failed';
        testResult.errors.push(error.message);
        console.log(`  ❌ Error: ${error.message}`);
      }

      this.results.routes.push(testResult);
      this.updateSummary(testResult);
    }
  }

  async testInteractions() {
    console.log('\n\n🖱️  Testing Interactive Elements:');
    console.log('-'.repeat(40));

    for (const pageTest of INTERACTIVE_TESTS) {
      console.log(`\nPage: ${pageTest.page}`);
      
      // Navigate to page
      try {
        await this.page.goto(`${THR_URL}${pageTest.page}`, { waitUntil: 'networkidle2' });
        
        for (const test of pageTest.tests) {
          const testResult = {
            page: pageTest.page,
            ...test,
            status: 'pending',
            errors: []
          };

          try {
            console.log(`  Testing: ${test.name}`);
            
            // Wait for element
            await this.page.waitForSelector(test.selector, { timeout: 5000 });
            
            // Perform action
            if (test.action === 'click') {
              await this.page.click(test.selector);
              // Wait for any dialog/modal
              await this.page.waitForTimeout(1000);
              
              // Check if dialog opened (look for common dialog selectors)
              const hasDialog = await this.page.$('.MuiDialog-root, [role="dialog"]');
              if (hasDialog) {
                console.log(`    ✅ Dialog opened successfully`);
                // Close dialog
                await this.page.keyboard.press('Escape');
                await this.page.waitForTimeout(500);
              }
            } else if (test.action === 'type') {
              await this.page.type(test.selector, test.value);
              console.log(`    ✅ Typed "${test.value}"`);
            }
            
            testResult.status = 'passed';
            
          } catch (error) {
            testResult.status = 'failed';
            testResult.errors.push(error.message);
            console.log(`    ❌ Failed: ${error.message}`);
          }

          this.results.interactions.push(testResult);
          this.updateSummary(testResult);
        }
      } catch (error) {
        console.log(`  ❌ Failed to load page: ${error.message}`);
      }
    }
  }

  async capturePerformanceMetrics() {
    console.log('\n\n📊 Capturing Performance Metrics:');
    console.log('-'.repeat(40));

    // Navigate to dashboard for metrics
    await this.page.goto(`${THR_URL}/dashboard`, { waitUntil: 'networkidle2' });

    // Get performance metrics
    const metrics = await this.page.metrics();
    const performanceTiming = await this.page.evaluate(() => JSON.stringify(window.performance.timing));
    
    this.results.performanceMetrics = {
      ...metrics,
      timing: JSON.parse(performanceTiming)
    };

    console.log(`  Heap Used: ${(metrics.JSHeapUsedSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Documents: ${metrics.Documents}`);
    console.log(`  Frames: ${metrics.Frames}`);
    console.log(`  Event Listeners: ${metrics.JSEventListeners}`);
  }

  updateSummary(testResult) {
    this.results.summary.totalTests++;
    
    if (testResult.status === 'passed') {
      this.results.summary.passed++;
    } else if (testResult.status === 'failed') {
      this.results.summary.failed++;
    }
    
    if (testResult.warnings && testResult.warnings.length > 0) {
      this.results.summary.warnings += testResult.warnings.length;
    }
  }

  async saveResults() {
    console.log('\n\n💾 Saving Results to Memory...');
    
    // Save to memory
    const memoryContent = `THR Health Check Complete: ${this.results.summary.passed}/${this.results.summary.totalTests} tests passed, ${this.results.summary.failed} failed, ${this.results.consoleErrors.length} console errors, ${this.results.networkErrors.length} network errors`;
    
    // Save detailed results to file
    const fs = require('fs');
    const resultsPath = `/tmp/thr-health-check-${Date.now()}.json`;
    fs.writeFileSync(resultsPath, JSON.stringify(this.results, null, 2));
    
    console.log(`  Results saved to: ${resultsPath}`);
    
    // Save to Supabase memory
    try {
      const { error } = await supabase
        .from('claude_desktop_memory')
        .insert({
          user_id: 'neo_todak',
          content: memoryContent,
          metadata: {
            tool: 'thr-health-check',
            project: 'THR',
            results_file: resultsPath,
            summary: this.results.summary
          },
          importance: this.results.summary.failed > 0 ? 8 : 5,
          category: 'Testing',
          memory_type: 'test_results',
          owner: 'neo_todak',
          source: 'ctk_health_check'
        });
        
      if (!error) {
        console.log('  ✅ Saved to Claude memory');
      }
    } catch (err) {
      console.log('  ⚠️  Could not save to memory:', err.message);
    }
  }

  async generateReport() {
    console.log('\n\n📋 Test Summary:');
    console.log('='.repeat(80));
    
    console.log(`Total Tests: ${this.results.summary.totalTests}`);
    console.log(`✅ Passed: ${this.results.summary.passed}`);
    console.log(`❌ Failed: ${this.results.summary.failed}`);
    console.log(`⚠️  Warnings: ${this.results.summary.warnings}`);
    
    if (this.results.consoleErrors.length > 0) {
      console.log(`\n🔴 Console Errors: ${this.results.consoleErrors.length}`);
      this.results.consoleErrors.slice(0, 3).forEach(err => {
        console.log(`  - ${err.text.substring(0, 100)}...`);
      });
    }
    
    if (this.results.networkErrors.length > 0) {
      console.log(`\n🔴 Network Errors: ${this.results.networkErrors.length}`);
      this.results.networkErrors.slice(0, 3).forEach(err => {
        console.log(`  - ${err.method} ${err.url}: ${err.error}`);
      });
    }
    
    // Show failed tests
    if (this.results.summary.failed > 0) {
      console.log('\n❌ Failed Tests:');
      
      this.results.routes.filter(r => r.status === 'failed').forEach(test => {
        console.log(`  - ${test.name}: ${test.errors.join(', ')}`);
      });
      
      this.results.interactions.filter(i => i.status === 'failed').forEach(test => {
        console.log(`  - ${test.name}: ${test.errors.join(', ')}`);
      });
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async run() {
    try {
      await this.init();
      await this.testRoutes();
      await this.testInteractions();
      await this.capturePerformanceMetrics();
      await this.saveResults();
      await this.generateReport();
    } catch (error) {
      console.error('\n❌ Health check failed:', error);
    } finally {
      await this.cleanup();
    }
  }
}

// Run the health check
if (require.main === module) {
  const healthCheck = new THRHealthCheck();
  healthCheck.run().catch(console.error);
}

module.exports = THRHealthCheck;