#!/usr/bin/env node

/**
 * Check Conversation Backup Status
 * Verifies if conversations are being backed up properly
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkBackups() {
    console.log('🔍 Checking conversation backups...\n');

    try {
        // Get recent conversations (last 24 hours)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        const { data: conversations, error } = await supabase
            .from('claude_desktop_memory')
            .select('metadata')
            .eq('metadata->>feature', 'conversation_checkpoint')
            .gte('created_at', oneDayAgo.toISOString());

        if (error) {
            console.error('❌ Error fetching conversations:', error);
            return;
        }

        // Group by conversation ID
        const conversationMap = conversations.reduce((acc, memory) => {
            const conversationId = memory.metadata?.conversation_id;
            if (!conversationId) return acc;
            
            if (!acc[conversationId]) {
                acc[conversationId] = {
                    checkpoints: 0,
                    backupTags: new Set()
                };
            }
            
            acc[conversationId].checkpoints++;
            if (memory.metadata?.backup_tag) {
                acc[conversationId].backupTags.add(memory.metadata.backup_tag);
            }
            
            return acc;
        }, {});

        // Analyze results
        console.log(`Found ${Object.keys(conversationMap).length} recent conversations\n`);
        
        Object.entries(conversationMap).forEach(([id, stats]) => {
            console.log(`Conversation ${id}:`);
            console.log(`  Checkpoints: ${stats.checkpoints}`);
            console.log(`  Backup tags: ${Array.from(stats.backupTags).join(', ') || 'none'}`);
            
            // Alert if too few checkpoints (expecting one every 5 mins)
            const expectedMin = Math.floor(24 * 60 / 5); // checkpoints in 24h
            if (stats.checkpoints < expectedMin / 2) {
                console.log('  ⚠️  Warning: Fewer checkpoints than expected');
            }
            
            console.log('');
        });

        // Check GitHub backup status via n8n tags
        const hasBackupTags = Object.values(conversationMap).some(
            stats => stats.backupTags.has('conversation_checkpoint')
        );

        if (!hasBackupTags) {
            console.log('⚠️  Warning: No conversations marked for n8n backup');
            console.log('Make sure n8n workflow is running and detecting conversation checkpoints');
        }

    } catch (err) {
        console.error('❌ Error checking backups:', err);
    }
}

// Run if called directly
if (require.main === module) {
    checkBackups();
}

module.exports = { checkBackups };