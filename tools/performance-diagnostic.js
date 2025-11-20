#!/usr/bin/env node

/**
 * Performance Diagnostic Tool
 * Analyzes project performance and provides actionable recommendations
 *
 * Usage:
 *   node performance-diagnostic.js [project-path]
 *   node performance-diagnostic.js  (uses current directory)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class PerformanceDiagnostic {
  constructor(projectPath = process.cwd()) {
    this.projectPath = projectPath;
    this.results = {
      score: 100,
      issues: [],
      warnings: [],
      recommendations: [],
      metrics: {}
    };
  }

  async run() {
    console.log('🔍 Performance Diagnostic Tool');
    console.log('━'.repeat(50));
    console.log(`📁 Project: ${this.projectPath}`);
    console.log('━'.repeat(50));
    console.log('');

    // Run all checks
    this.checkProjectType();
    this.analyzeBundleSize();
    this.checkDependencies();
    this.scanForPerformanceAntiPatterns();
    this.checkDatabaseQueries();
    this.analyzeComponentStructure();
    this.checkBuildConfiguration();
    this.checkMemoryLeaks();

    // Generate report
    this.generateReport();
  }

  checkProjectType() {
    const packageJsonPath = path.join(this.projectPath, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      console.log('⚠️  No package.json found - not a Node.js project');
      return;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    this.results.metrics.projectName = packageJson.name;
    this.results.metrics.version = packageJson.version;

    // Detect framework
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    if (deps.react) {
      this.results.metrics.framework = 'React';
      this.results.metrics.reactVersion = deps.react;
    } else if (deps.vue) {
      this.results.metrics.framework = 'Vue';
    } else if (deps['@angular/core']) {
      this.results.metrics.framework = 'Angular';
    } else if (deps.next) {
      this.results.metrics.framework = 'Next.js';
    }

    console.log(`✅ Project Type: ${this.results.metrics.framework || 'Unknown'}`);
  }

  analyzeBundleSize() {
    console.log('\n📦 Bundle Size Analysis...');

    const distPath = path.join(this.projectPath, 'dist');
    const buildPath = path.join(this.projectPath, 'build');

    let bundlePath = null;
    if (fs.existsSync(distPath)) {
      bundlePath = distPath;
    } else if (fs.existsSync(buildPath)) {
      bundlePath = buildPath;
    }

    if (!bundlePath) {
      console.log('   ⚠️  No build directory found (dist/ or build/)');
      console.log('   💡 Run your build command first: npm run build');
      return;
    }

    // Get all JS files
    const jsFiles = this.getFilesRecursive(bundlePath, '.js');

    if (jsFiles.length === 0) {
      console.log('   ⚠️  No JavaScript bundles found');
      return;
    }

    let totalSize = 0;
    let largeFiles = [];

    jsFiles.forEach(file => {
      const stats = fs.statSync(file);
      const sizeKB = stats.size / 1024;
      totalSize += sizeKB;

      if (sizeKB > 500) {
        largeFiles.push({
          file: path.relative(bundlePath, file),
          size: sizeKB
        });
      }
    });

    this.results.metrics.bundleSize = {
      total: totalSize.toFixed(2) + ' KB',
      files: jsFiles.length,
      largeFiles: largeFiles.length
    };

    console.log(`   📊 Total Bundle Size: ${totalSize.toFixed(2)} KB`);
    console.log(`   📄 Number of JS Files: ${jsFiles.length}`);

    // Check for large bundles
    if (totalSize > 2000) {
      this.results.score -= 15;
      this.results.issues.push({
        severity: 'high',
        category: 'Bundle Size',
        message: `Very large bundle size: ${totalSize.toFixed(2)} KB`,
        recommendation: 'Implement code splitting and lazy loading'
      });
      console.log('   🔴 Issue: Bundle size exceeds 2MB');
    } else if (totalSize > 1000) {
      this.results.score -= 10;
      this.results.warnings.push({
        category: 'Bundle Size',
        message: `Large bundle size: ${totalSize.toFixed(2)} KB`,
        recommendation: 'Consider code splitting for better performance'
      });
      console.log('   🟡 Warning: Bundle size exceeds 1MB');
    } else {
      console.log('   ✅ Bundle size is acceptable');
    }

    // Report large files
    if (largeFiles.length > 0) {
      console.log(`\n   📌 Large Files (>500KB):`);
      largeFiles.sort((a, b) => b.size - a.size).forEach(f => {
        console.log(`      • ${f.file}: ${f.size.toFixed(2)} KB`);

        if (f.size > 1000) {
          this.results.recommendations.push({
            category: 'Code Splitting',
            message: `Split ${f.file} into smaller chunks`,
            impact: 'high'
          });
        }
      });
    }
  }

  checkDependencies() {
    console.log('\n📚 Dependency Analysis...');

    const packageJsonPath = path.join(this.projectPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return;

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const deps = packageJson.dependencies || {};
    const devDeps = packageJson.devDependencies || {};

    const allDeps = { ...deps, ...devDeps };
    const heavyDeps = {
      'moment': 'Use day.js or date-fns instead (much lighter)',
      'lodash': 'Use lodash-es and import only what you need',
      '@mui/material': 'Consider using tree-shaking or lighter alternatives',
      'chart.js': 'Heavy library, ensure you only import needed components'
    };

    let foundHeavyDeps = [];
    Object.keys(heavyDeps).forEach(dep => {
      if (allDeps[dep]) {
        foundHeavyDeps.push({ dep, reason: heavyDeps[dep] });
      }
    });

    if (foundHeavyDeps.length > 0) {
      console.log(`   ⚠️  Heavy Dependencies Found:`);
      foundHeavyDeps.forEach(({ dep, reason }) => {
        console.log(`      • ${dep}: ${reason}`);
        this.results.warnings.push({
          category: 'Dependencies',
          message: `Heavy dependency: ${dep}`,
          recommendation: reason
        });
      });
      this.results.score -= foundHeavyDeps.length * 3;
    } else {
      console.log('   ✅ No heavy dependencies detected');
    }

    // Check for duplicate dependencies
    const depCount = Object.keys(deps).length + Object.keys(devDeps).length;
    console.log(`   📊 Total Dependencies: ${depCount}`);

    if (depCount > 100) {
      this.results.warnings.push({
        category: 'Dependencies',
        message: `Large number of dependencies: ${depCount}`,
        recommendation: 'Review and remove unused dependencies'
      });
      console.log('   🟡 Warning: Many dependencies installed');
      this.results.score -= 5;
    }
  }

  scanForPerformanceAntiPatterns() {
    console.log('\n🔎 Scanning for Performance Anti-Patterns...');

    const srcPath = path.join(this.projectPath, 'src');
    if (!fs.existsSync(srcPath)) {
      console.log('   ⚠️  No src/ directory found');
      return;
    }

    const jsxFiles = this.getFilesRecursive(srcPath, '.jsx', '.tsx', '.js', '.ts');

    let antiPatterns = {
      inlineArrowFunctions: 0,
      consoleLog: 0,
      dangerouslySetInnerHTML: 0,
      forceUpdate: 0,
      findDOMNode: 0
    };

    jsxFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');

      // Check for inline arrow functions in JSX
      const inlineArrowMatches = content.match(/onClick=\{.*?=>/g) || [];
      antiPatterns.inlineArrowFunctions += inlineArrowMatches.length;

      // Check for console.log
      const consoleMatches = content.match(/console\.log/g) || [];
      antiPatterns.consoleLog += consoleMatches.length;

      // Check for dangerouslySetInnerHTML
      if (content.includes('dangerouslySetInnerHTML')) {
        antiPatterns.dangerouslySetInnerHTML++;
      }

      // Check for forceUpdate
      if (content.includes('forceUpdate')) {
        antiPatterns.forceUpdate++;
      }

      // Check for findDOMNode
      if (content.includes('findDOMNode')) {
        antiPatterns.findDOMNode++;
      }
    });

    let foundIssues = false;

    if (antiPatterns.inlineArrowFunctions > 50) {
      console.log(`   🟡 Found ${antiPatterns.inlineArrowFunctions} inline arrow functions in event handlers`);
      this.results.warnings.push({
        category: 'React Performance',
        message: 'Many inline arrow functions in event handlers',
        recommendation: 'Use useCallback or class methods to avoid re-creating functions'
      });
      this.results.score -= 5;
      foundIssues = true;
    }

    if (antiPatterns.consoleLog > 100) {
      console.log(`   🟡 Found ${antiPatterns.consoleLog} console.log statements`);
      this.results.warnings.push({
        category: 'Production Code',
        message: 'Many console.log statements in code',
        recommendation: 'Remove or use a logging library with levels'
      });
      this.results.score -= 3;
      foundIssues = true;
    }

    if (antiPatterns.dangerouslySetInnerHTML > 0) {
      console.log(`   🔴 Found ${antiPatterns.dangerouslySetInnerHTML} uses of dangerouslySetInnerHTML`);
      this.results.issues.push({
        severity: 'medium',
        category: 'Security & Performance',
        message: 'Using dangerouslySetInnerHTML',
        recommendation: 'Ensure XSS protection and consider alternatives'
      });
      this.results.score -= 5;
      foundIssues = true;
    }

    if (!foundIssues) {
      console.log('   ✅ No major anti-patterns detected');
    }
  }

  checkDatabaseQueries() {
    console.log('\n🗄️  Database Query Analysis...');

    const srcPath = path.join(this.projectPath, 'src');
    if (!fs.existsSync(srcPath)) return;

    const files = this.getFilesRecursive(srcPath, '.js', '.jsx', '.ts', '.tsx');

    let queryPatterns = {
      selectStar: 0,
      missingLimit: 0,
      nestedQueries: 0,
      multipleAwait: 0
    };

    files.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');

      // Check for SELECT *
      const selectStarMatches = content.match(/\.select\(['"]?\*['"]?\)/g) || [];
      queryPatterns.selectStar += selectStarMatches.length;

      // Check for queries without limit
      const selectMatches = content.match(/\.select\([^)]+\)/g) || [];
      selectMatches.forEach(match => {
        const nextChars = content.substring(content.indexOf(match) + match.length, content.indexOf(match) + match.length + 100);
        if (!nextChars.includes('.limit(') && !nextChars.includes('.single()')) {
          queryPatterns.missingLimit++;
        }
      });

      // Check for multiple awaits in loops
      const awaitInLoopMatches = content.match(/for.*\{[^}]*await/gs) || [];
      queryPatterns.multipleAwait += awaitInLoopMatches.length;
    });

    let foundIssues = false;

    if (queryPatterns.selectStar > 10) {
      console.log(`   🟡 Found ${queryPatterns.selectStar} SELECT * queries`);
      this.results.warnings.push({
        category: 'Database',
        message: 'Using SELECT * in queries',
        recommendation: 'Specify only needed columns to reduce data transfer'
      });
      this.results.score -= 5;
      foundIssues = true;
    }

    if (queryPatterns.missingLimit > 10) {
      console.log(`   🔴 Found ${queryPatterns.missingLimit} queries without LIMIT`);
      this.results.issues.push({
        severity: 'high',
        category: 'Database',
        message: 'Queries without LIMIT clause',
        recommendation: 'Add pagination or limit to prevent loading large datasets'
      });
      this.results.score -= 10;
      foundIssues = true;
    }

    if (queryPatterns.multipleAwait > 0) {
      console.log(`   🔴 Found ${queryPatterns.multipleAwait} await statements in loops`);
      this.results.issues.push({
        severity: 'high',
        category: 'Database',
        message: 'Sequential await in loops',
        recommendation: 'Use Promise.all() to run queries in parallel'
      });
      this.results.score -= 10;
      foundIssues = true;
    }

    if (!foundIssues) {
      console.log('   ✅ Database queries look good');
    }
  }

  analyzeComponentStructure() {
    console.log('\n⚛️  Component Structure Analysis...');

    const srcPath = path.join(this.projectPath, 'src');
    if (!fs.existsSync(srcPath)) return;

    const componentFiles = this.getFilesRecursive(srcPath, '.jsx', '.tsx');

    let largeComponents = [];
    let totalComponents = 0;

    componentFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n').length;

      if (lines > 300) {
        largeComponents.push({
          file: path.relative(this.projectPath, file),
          lines
        });
      }

      totalComponents++;
    });

    console.log(`   📊 Total Components: ${totalComponents}`);

    if (largeComponents.length > 0) {
      console.log(`   🟡 Large Components (>300 lines):`);
      largeComponents.sort((a, b) => b.lines - a.lines).slice(0, 5).forEach(c => {
        console.log(`      • ${c.file}: ${c.lines} lines`);
      });

      this.results.warnings.push({
        category: 'Component Size',
        message: `${largeComponents.length} components exceed 300 lines`,
        recommendation: 'Split large components into smaller, reusable pieces'
      });
      this.results.score -= Math.min(largeComponents.length, 10);
    } else {
      console.log('   ✅ Component sizes look good');
    }
  }

  checkBuildConfiguration() {
    console.log('\n⚙️  Build Configuration...');

    // Check for vite.config or webpack.config
    const viteConfig = fs.existsSync(path.join(this.projectPath, 'vite.config.js')) ||
                      fs.existsSync(path.join(this.projectPath, 'vite.config.ts'));
    const webpackConfig = fs.existsSync(path.join(this.projectPath, 'webpack.config.js'));

    if (viteConfig) {
      console.log('   ✅ Using Vite (fast build tool)');

      // Check for build optimizations
      const configPath = path.join(this.projectPath, 'vite.config.js');
      if (fs.existsSync(configPath)) {
        const config = fs.readFileSync(configPath, 'utf8');

        if (!config.includes('manualChunks')) {
          this.results.recommendations.push({
            category: 'Build Optimization',
            message: 'Configure manual chunks in Vite',
            impact: 'medium'
          });
          console.log('   💡 Recommendation: Configure manualChunks for better code splitting');
        }
      }
    } else if (webpackConfig) {
      console.log('   ✅ Using Webpack');
    } else {
      console.log('   ⚠️  No build configuration found');
    }
  }

  checkMemoryLeaks() {
    console.log('\n🔍 Memory Leak Patterns...');

    const srcPath = path.join(this.projectPath, 'src');
    if (!fs.existsSync(srcPath)) return;

    const files = this.getFilesRecursive(srcPath, '.jsx', '.tsx', '.js', '.ts');

    let leakPatterns = {
      missingCleanup: 0,
      globalEventListeners: 0
    };

    files.forEach(file => {
      const content = fs.readFileSync(file, 'utf8');

      // Check for useEffect with addEventListener but no cleanup
      const useEffectMatches = content.match(/useEffect\(\(\) => \{[\s\S]*?addEventListener[\s\S]*?\}/g) || [];
      useEffectMatches.forEach(match => {
        if (!match.includes('removeEventListener') && !match.includes('return () =>')) {
          leakPatterns.missingCleanup++;
        }
      });

      // Check for global event listeners
      const globalListeners = content.match(/window\.addEventListener|document\.addEventListener/g) || [];
      leakPatterns.globalEventListeners += globalListeners.length;
    });

    if (leakPatterns.missingCleanup > 0) {
      console.log(`   🔴 Found ${leakPatterns.missingCleanup} event listeners without cleanup`);
      this.results.issues.push({
        severity: 'medium',
        category: 'Memory Leaks',
        message: 'Event listeners without cleanup in useEffect',
        recommendation: 'Always return a cleanup function from useEffect'
      });
      this.results.score -= 10;
    } else {
      console.log('   ✅ No obvious memory leak patterns detected');
    }
  }

  generateReport() {
    console.log('\n' + '═'.repeat(50));
    console.log('📊 PERFORMANCE DIAGNOSTIC REPORT');
    console.log('═'.repeat(50));

    // Calculate final score
    this.results.score = Math.max(0, Math.min(100, this.results.score));

    // Score interpretation
    let grade, emoji;
    if (this.results.score >= 90) {
      grade = 'Excellent';
      emoji = '🟢';
    } else if (this.results.score >= 75) {
      grade = 'Good';
      emoji = '🟡';
    } else if (this.results.score >= 60) {
      grade = 'Fair';
      emoji = '🟠';
    } else {
      grade = 'Needs Improvement';
      emoji = '🔴';
    }

    console.log(`\n${emoji} Overall Score: ${this.results.score}/100 (${grade})`);

    // Critical Issues
    if (this.results.issues.length > 0) {
      console.log('\n🔴 CRITICAL ISSUES:');
      this.results.issues.forEach((issue, i) => {
        console.log(`\n${i + 1}. [${issue.category}] ${issue.message}`);
        console.log(`   💡 ${issue.recommendation}`);
      });
    }

    // Warnings
    if (this.results.warnings.length > 0) {
      console.log('\n🟡 WARNINGS:');
      this.results.warnings.forEach((warning, i) => {
        console.log(`\n${i + 1}. [${warning.category}] ${warning.message}`);
        console.log(`   💡 ${warning.recommendation}`);
      });
    }

    // Recommendations
    if (this.results.recommendations.length > 0) {
      console.log('\n💡 RECOMMENDATIONS:');
      this.results.recommendations.forEach((rec, i) => {
        console.log(`${i + 1}. [${rec.category}] ${rec.message} (Impact: ${rec.impact})`);
      });
    }

    // Summary
    console.log('\n' + '─'.repeat(50));
    console.log('SUMMARY:');
    console.log(`  • Critical Issues: ${this.results.issues.length}`);
    console.log(`  • Warnings: ${this.results.warnings.length}`);
    console.log(`  • Recommendations: ${this.results.recommendations.length}`);

    if (this.results.metrics.bundleSize) {
      console.log(`  • Bundle Size: ${this.results.metrics.bundleSize.total}`);
    }

    console.log('─'.repeat(50));
    console.log('\n✅ Diagnostic complete!\n');

    // Save report to file
    const reportPath = path.join(this.projectPath, 'performance-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
    console.log(`📄 Detailed report saved to: ${reportPath}\n`);
  }

  getFilesRecursive(dir, ...extensions) {
    let results = [];

    if (!fs.existsSync(dir)) return results;

    const files = fs.readdirSync(dir);

    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        // Skip node_modules and build directories
        if (!['node_modules', 'dist', 'build', '.git'].includes(file)) {
          results = results.concat(this.getFilesRecursive(filePath, ...extensions));
        }
      } else {
        const ext = path.extname(file);
        if (extensions.includes(ext)) {
          results.push(filePath);
        }
      }
    });

    return results;
  }
}

// Run diagnostic
const projectPath = process.argv[2] || process.cwd();
const diagnostic = new PerformanceDiagnostic(projectPath);
diagnostic.run().catch(err => {
  console.error('Error running diagnostic:', err);
  process.exit(1);
});
