#!/usr/bin/env node

/**
 * Fix machine name inconsistencies in claude_desktop_memory
 * 
 * Issues to fix:
 * 1. NULL/undefined machine entries (915 records)
 * 2. Multiple MacBook variants (mac, MacBook, MacBook-Pro-3.local)
 * 3. Inconsistent naming conventions
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Machine name mappings for standardization
const MACHINE_MAPPINGS = {
    // MacBook variants
    'mac': 'MacBook Pro',
    'MacBook': 'MacBook Pro',
    'MacBook-Pro-3.local': 'MacBook Pro',
    
    // Windows variants
    'Windows Home PC': 'Windows Home PC',
    'Home PC': 'Windows Home PC',
    'home_pc': 'Windows Home PC',
    'NEO-MOTHERSHIP': 'Windows Home PC',
    'DESKTOP-NEO-WIN11': 'Windows Home PC',
    
    // Office PC
    'windows_office_pc': 'Windows Office PC',
    
    // Gaming PC
    'windows_bandung_gaming': 'Windows Gaming PC',
    
    // Special case
    'claude_desktop': 'Unknown',
    'NULL/undefined': null  // Will need special handling
};

async function fixMachineNames() {
    console.log('🔧 Machine Name Standardization\n');
    
    // Step 1: Analyze current state
    console.log('📊 Analyzing current machine names...\n');
    
    const { data: allRecords, error: fetchError } = await supabase
        .from('claude_desktop_memory')
        .select('id, metadata, owner, created_at')
        .order('created_at', { ascending: false });
        
    if (fetchError) {
        console.error('❌ Error fetching records:', fetchError);
        return;
    }
    
    // Group by machine and analyze
    const machineStats = {};
    const nullMachineByOwner = {};
    
    allRecords.forEach(record => {
        const machine = record.metadata?.machine || 'NULL';
        const owner = record.owner || 'NULL';
        
        if (!machineStats[machine]) {
            machineStats[machine] = 0;
        }
        machineStats[machine]++;
        
        // Track NULL machines by owner for intelligent assignment
        if (!record.metadata?.machine) {
            if (!nullMachineByOwner[owner]) {
                nullMachineByOwner[owner] = [];
            }
            nullMachineByOwner[owner].push(record);
        }
    });
    
    console.log('Current machine distribution:');
    Object.entries(machineStats)
        .sort((a, b) => b[1] - a[1])
        .forEach(([machine, count]) => {
            console.log(`  ${machine}: ${count} records`);
        });
    
    console.log('\n⚠️  This will update machine names as follows:');
    console.log('  - Standardize MacBook variants → "MacBook Pro"');
    console.log('  - Standardize Windows variants → "Windows Home PC"');
    console.log('  - Fix NULL machines based on owner patterns');
    console.log('\nPress Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Step 2: Fix known mappings
    console.log('🔄 Updating known machine names...\n');
    
    let totalFixed = 0;
    
    for (const [oldName, newName] of Object.entries(MACHINE_MAPPINGS)) {
        if (oldName === 'NULL/undefined' || !newName) continue;
        
        // Get records with this machine name
        const { data: records } = await supabase
            .from('claude_desktop_memory')
            .select('id, metadata')
            .eq('metadata->>machine', oldName);
            
        if (records && records.length > 0) {
            console.log(`Updating ${records.length} records from "${oldName}" to "${newName}"...`);
            
            // Update in batches
            for (const record of records) {
                const updatedMetadata = {
                    ...record.metadata,
                    machine: newName,
                    machine_original: record.metadata.machine  // Keep original for reference
                };
                
                const { error: updateError } = await supabase
                    .from('claude_desktop_memory')
                    .update({ metadata: updatedMetadata })
                    .eq('id', record.id);
                    
                if (!updateError) {
                    totalFixed++;
                }
            }
        }
    }
    
    // Step 3: Fix NULL machines intelligently
    console.log('\n🔍 Fixing NULL machine entries...\n');
    
    // Determine most likely machine for each owner based on recent activities
    for (const [owner, records] of Object.entries(nullMachineByOwner)) {
        if (owner === 'NULL') {
            console.log(`Skipping ${records.length} records with NULL owner...`);
            continue;
        }
        
        // Find the most recent record with a machine for this owner
        const { data: recentWithMachine } = await supabase
            .from('claude_desktop_memory')
            .select('metadata')
            .eq('owner', owner)
            .not('metadata->>machine', 'is', null)
            .order('created_at', { ascending: false })
            .limit(5);
            
        if (recentWithMachine && recentWithMachine.length > 0) {
            // Use the most common machine from recent records
            const machineCounts = {};
            recentWithMachine.forEach(r => {
                const m = r.metadata?.machine;
                if (m) {
                    machineCounts[m] = (machineCounts[m] || 0) + 1;
                }
            });
            
            const likelyMachine = Object.entries(machineCounts)
                .sort((a, b) => b[1] - a[1])[0]?.[0];
                
            if (likelyMachine) {
                console.log(`Updating ${records.length} NULL machines for ${owner} to "${likelyMachine}"...`);
                
                for (const record of records) {
                    const updatedMetadata = {
                        ...record.metadata,
                        machine: likelyMachine,
                        machine_inferred: true
                    };
                    
                    const { error: updateError } = await supabase
                        .from('claude_desktop_memory')
                        .update({ metadata: updatedMetadata })
                        .eq('id', record.id);
                        
                    if (!updateError) {
                        totalFixed++;
                    }
                }
            }
        }
    }
    
    console.log(`\n✅ Fixed ${totalFixed} machine entries!`);
    
    // Step 4: Verify results
    console.log('\n📊 Verification:\n');
    
    const { data: verifyData } = await supabase
        .from('claude_desktop_memory')
        .select('metadata')
        .limit(2000);
        
    const finalStats = {};
    let nullCount = 0;
    
    verifyData?.forEach(record => {
        const machine = record.metadata?.machine;
        if (!machine) {
            nullCount++;
        } else {
            finalStats[machine] = (finalStats[machine] || 0) + 1;
        }
    });
    
    console.log('Final machine distribution:');
    Object.entries(finalStats)
        .sort((a, b) => b[1] - a[1])
        .forEach(([machine, count]) => {
            console.log(`  ${machine}: ${count} records`);
        });
    console.log(`  NULL/undefined: ${nullCount} records`);
    
    console.log('\n🎉 Machine name standardization complete!');
}

// Run the fix
fixMachineNames().catch(console.error);