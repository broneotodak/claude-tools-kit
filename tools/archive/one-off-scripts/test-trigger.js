#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/mnt/h/Projects/Active/claudecode/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testTrigger() {
    console.log('🧪 Testing Memory-to-Activity Trigger\n');
    
    // Create a test memory
    const testMemory = {
        user_id: 'neo_todak',
        memory_type: 'technical_solution',
        category: 'FlowState AI',
        content: 'TRIGGER TEST: Created database trigger for automatic memory-to-activity sync. No more manual scripts needed!',
        metadata: {
            tool: 'claude_code',
            feature: 'database_trigger',
            machine: 'Windows Home PC',
            project: 'FlowState AI',
            actual_source: 'claude_code',
            environment: 'WSL Ubuntu',
            date: new Date().toISOString().split('T')[0],
            test: true
        },
        importance: 5,
        source: 'claude_desktop'
    };
    
    try {
        console.log('1️⃣ Inserting test memory...');
        const { data: memory, error: memError } = await supabase
            .from('claude_desktop_memory')
            .insert([testMemory])
            .select()
            .single();
            
        if (memError) {
            console.error('❌ Error creating memory:', memError);
            return;
        }
        
        console.log('✅ Memory created with ID:', memory.id);
        
        // Wait a moment for trigger to execute
        console.log('\n2️⃣ Waiting for trigger to execute...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if activity was created
        console.log('\n3️⃣ Checking for auto-created activity...');
        const { data: activities, error: actError } = await supabase
            .from('flowstate_activities')
            .select('*')
            .eq('metadata->memory_id', memory.id)
            .single();
            
        if (actError) {
            console.error('❌ No activity found. Trigger may not be installed.');
            console.log('\n📝 Please execute the SQL trigger script in Supabase:');
            console.log('   File: /home/neo/claude-tools/create-memory-sync-trigger.sql');
            return;
        }
        
        console.log('✅ Activity auto-created by trigger!');
        console.log('\n📊 Activity Details:');
        console.log('   Project:', activities.project_name);
        console.log('   Type:', activities.activity_type);
        console.log('   Description:', activities.activity_description.substring(0, 50) + '...');
        console.log('\n🔧 Metadata preserved:');
        console.log('   Machine:', activities.metadata.machine);
        console.log('   Tool:', activities.metadata.tool);
        console.log('   Environment:', activities.metadata.environment);
        console.log('   Source:', activities.metadata.source);
        
        console.log('\n🎉 Trigger is working perfectly!');
        
    } catch (err) {
        console.error('❌ Test failed:', err);
    }
}

testTrigger();