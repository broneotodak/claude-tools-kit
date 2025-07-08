#!/usr/bin/env node

/**
 * Fix NULL owners in claude_desktop_memory table
 * This is a general fix for a common Claude Code issue where memories 
 * are saved without proper owner attribution
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Get credentials from environment
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing required environment variables:');
    console.error('   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)');
    console.error('   Please ensure your .env file is properly configured.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixNullOwners() {
    console.log('🔧 Claude Memory NULL Owner Fix\n');
    console.log('This tool fixes memories that were saved without proper owner attribution.\n');

    // Step 1: Check for NULL owners
    console.log('📊 Checking for memories with NULL owners...');
    
    const { data: nullOwnerCount, error: countError } = await supabase
        .from('claude_desktop_memory')
        .select('id', { count: 'exact', head: true })
        .is('owner', null);

    if (countError) {
        console.error('❌ Error checking for NULL owners:', countError);
        return;
    }

    const totalNull = nullOwnerCount?.length || 0;
    
    if (totalNull === 0) {
        console.log('✅ No memories with NULL owners found. Everything looks good!');
        return;
    }

    console.log(`⚠️  Found ${totalNull} memories with NULL owners\n`);

    // Step 2: Get user confirmation
    console.log('This fix will update all memories with NULL owners.');
    console.log('The owner will be set based on metadata.user_id or a default value.\n');
    
    // In a real interactive environment, you'd prompt for confirmation
    // For now, we'll proceed with the fix

    // Step 3: Get memories with NULL owners
    const { data: nullMemories, error: fetchError } = await supabase
        .from('claude_desktop_memory')
        .select('id, metadata')
        .is('owner', null)
        .limit(1000); // Process in batches

    if (fetchError) {
        console.error('❌ Error fetching memories:', fetchError);
        return;
    }

    // Step 4: Update owners based on metadata
    let updated = 0;
    let failed = 0;

    for (const memory of nullMemories) {
        // Try to determine owner from metadata
        let owner = null;
        
        if (memory.metadata) {
            // Check various possible fields in metadata
            owner = memory.metadata.user_id || 
                   memory.metadata.user || 
                   memory.metadata.owner ||
                   'neo_todak'; // Default if no user info in metadata
        } else {
            owner = 'neo_todak'; // Default owner
        }

        const { error: updateError } = await supabase
            .from('claude_desktop_memory')
            .update({ owner })
            .eq('id', memory.id);

        if (updateError) {
            console.error(`❌ Failed to update memory ${memory.id}:`, updateError);
            failed++;
        } else {
            updated++;
            if (updated % 10 === 0) {
                process.stdout.write(`\r📝 Progress: ${updated}/${nullMemories.length}`);
            }
        }
    }

    console.log('\n');
    console.log('📊 Fix Summary:');
    console.log(`   ✅ Successfully updated: ${updated} memories`);
    if (failed > 0) {
        console.log(`   ❌ Failed to update: ${failed} memories`);
    }

    // Step 5: Verify the fix
    const { data: remainingNull, error: verifyError } = await supabase
        .from('claude_desktop_memory')
        .select('id', { count: 'exact', head: true })
        .is('owner', null);

    if (!verifyError) {
        const remaining = remainingNull?.length || 0;
        if (remaining === 0) {
            console.log('\n✨ All memories now have proper owners!');
        } else {
            console.log(`\n⚠️  ${remaining} memories still have NULL owners (may need manual review)`);
        }
    }

    // Step 6: Provide recommendations
    console.log('\n💡 Recommendations:');
    console.log('1. Ensure all Claude Code instances save memories with proper owner field');
    console.log('2. Consider adding a database trigger to auto-set owner when NULL');
    console.log('3. Update memory-saving tools to always include owner information');
}

// Run the fix
fixNullOwners().catch(error => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
});