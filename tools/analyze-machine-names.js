#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/mnt/h/Projects/Active/claudecode/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function analyzeMachineNames() {
    try {
        // Get all unique machine names from activities
        const { data, error } = await supabase
            .from('flowstate_activities')
            .select('metadata')
            .not('metadata', 'is', null);

        if (error) {
            console.error('Error:', error);
            return;
        }

        // Extract and count machine names
        const machineCount = {};
        const machineSamples = {};
        
        data.forEach(activity => {
            const machine = activity.metadata?.machine;
            if (machine) {
                machineCount[machine] = (machineCount[machine] || 0) + 1;
                
                // Store a sample of metadata for each machine
                if (!machineSamples[machine]) {
                    machineSamples[machine] = activity.metadata;
                }
            }
        });

        console.log('🖥️  Machine Name Analysis\n');
        console.log('Found machines:');
        Object.entries(machineCount)
            .sort((a, b) => b[1] - a[1])
            .forEach(([machine, count]) => {
                console.log(`  ${machine}: ${count} activities`);
                console.log(`    Sample metadata:`, JSON.stringify(machineSamples[machine], null, 2).substring(0, 200) + '...\n');
            });

        // Identify duplicates/variations
        console.log('\n🔍 Potential Duplicates:');
        const machines = Object.keys(machineCount);
        
        // Check for Windows variations
        const windowsMachines = machines.filter(m => 
            m.toLowerCase().includes('windows') || 
            m.toLowerCase().includes('pc') ||
            m === 'NEO-MOTHERSHIP'
        );
        
        if (windowsMachines.length > 1) {
            console.log('  Windows PC variations:', windowsMachines);
        }

        // Get system hostname
        const os = require('os');
        console.log('\n💻 Current System Info:');
        console.log('  Hostname:', os.hostname());
        console.log('  Platform:', os.platform());
        console.log('  Type:', os.type());

    } catch (err) {
        console.error('Failed:', err);
    }
}

analyzeMachineNames();