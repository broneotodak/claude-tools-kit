#!/usr/bin/env node

/**
 * Memory Health Check Tool for Claude Code
 * Checks for common issues in claude_desktop_memory table
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Get credentials from environment
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing required environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMemoryHealth() {
    console.log('🔍 Claude Memory Health Check\n');
    console.log('Analyzing claude_desktop_memory table for common issues...\n');

    const issues = [];
    let totalMemories = 0;

    try {
        // 1. Get total count
        const { count: total } = await supabase
            .from('claude_desktop_memory')
            .select('*', { count: 'exact', head: true });
        
        totalMemories = total || 0;
        console.log(`📊 Total memories: ${totalMemories}`);

        // 2. Check for NULL owners
        const { count: nullOwners } = await supabase
            .from('claude_desktop_memory')
            .select('*', { count: 'exact', head: true })
            .is('owner', null);

        if (nullOwners > 0) {
            issues.push({
                type: 'NULL_OWNERS',
                count: nullOwners,
                severity: 'HIGH',
                message: `${nullOwners} memories have NULL owners`,
                fix: 'Run fix-memory-null-owners.js tool'
            });
        }

        // 3. Check for missing metadata
        const { data: noMetadata } = await supabase
            .from('claude_desktop_memory')
            .select('id')
            .is('metadata', null)
            .limit(1000);

        if (noMetadata && noMetadata.length > 0) {
            issues.push({
                type: 'NO_METADATA',
                count: noMetadata.length,
                severity: 'MEDIUM',
                message: `${noMetadata.length} memories have no metadata`,
                fix: 'Update memories with proper metadata structure'
            });
        }

        // 4. Check for invalid sources
        const validSources = [
            'claude_desktop', 'claude_code', 'browser_extension', 
            'manual', 'api', 'automation', 'sync'
        ];

        const { data: allSources } = await supabase
            .from('claude_desktop_memory')
            .select('source')
            .limit(10000);

        const invalidSources = new Set();
        allSources?.forEach(row => {
            if (row.source && !validSources.includes(row.source)) {
                invalidSources.add(row.source);
            }
        });

        if (invalidSources.size > 0) {
            issues.push({
                type: 'INVALID_SOURCES',
                count: invalidSources.size,
                severity: 'LOW',
                message: `Found invalid sources: ${Array.from(invalidSources).join(', ')}`,
                fix: 'Standardize source values'
            });
        }

        // 5. Check recent activity
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        const { count: recentCount } = await supabase
            .from('claude_desktop_memory')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', oneDayAgo.toISOString());

        console.log(`📈 Memories in last 24 hours: ${recentCount || 0}`);

        // 6. Check for duplicate content
        const { data: recentMemories } = await supabase
            .from('claude_desktop_memory')
            .select('content')
            .order('created_at', { ascending: false })
            .limit(100);

        const contentMap = new Map();
        let duplicates = 0;
        
        recentMemories?.forEach(row => {
            const content = row.content?.toLowerCase().trim();
            if (content) {
                if (contentMap.has(content)) {
                    duplicates++;
                } else {
                    contentMap.set(content, true);
                }
            }
        });

        if (duplicates > 0) {
            issues.push({
                type: 'DUPLICATE_CONTENT',
                count: duplicates,
                severity: 'LOW',
                message: `Found ${duplicates} potential duplicates in recent memories`,
                fix: 'Review and deduplicate similar memories'
            });
        }

        // Display results
        console.log('\n📋 Health Check Results:\n');

        if (issues.length === 0) {
            console.log('✅ All checks passed! Memory system is healthy.');
        } else {
            console.log(`⚠️  Found ${issues.length} issue(s):\n`);
            
            // Sort by severity
            const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
            issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

            issues.forEach((issue, index) => {
                console.log(`${index + 1}. [${issue.severity}] ${issue.message}`);
                console.log(`   Fix: ${issue.fix}\n`);
            });
        }

        // Recommendations
        console.log('💡 Recommendations:');
        console.log('1. Run health checks regularly (weekly)');
        console.log('2. Always save memories with proper owner and metadata');
        console.log('3. Use save-memory-enhanced.js for consistent memory format');
        console.log('4. Consider setting up automated cleanup for old memories');

    } catch (error) {
        console.error('❌ Error during health check:', error);
        process.exit(1);
    }
}

// Run health check
checkMemoryHealth();