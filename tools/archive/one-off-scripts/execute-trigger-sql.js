#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '/mnt/h/Projects/Active/claudecode/.env' });

const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function executeSql() {
    try {
        // Read the SQL file
        const sql = fs.readFileSync('/home/neo/claude-tools/create-memory-sync-trigger.sql', 'utf8');
        
        // Execute via Supabase REST API using RPC
        const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/execute_sql`, {
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify({ query: sql })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('❌ Failed to execute SQL:', error);
            
            // Try alternative approach - execute statements separately
            console.log('\n🔄 Trying alternative approach...\n');
            
            // Split SQL into individual statements
            const statements = sql.split(';').filter(s => s.trim());
            
            for (let i = 0; i < statements.length - 1; i++) { // Skip the last SELECT
                const stmt = statements[i].trim() + ';';
                console.log(`Executing statement ${i + 1}...`);
                
                // For now, we'll need to use the SQL editor in Supabase dashboard
                console.log('Statement preview:', stmt.substring(0, 50) + '...');
            }
            
            console.log('\n📝 SQL script saved to: /home/neo/claude-tools/create-memory-sync-trigger.sql');
            console.log('\n⚠️  Please execute this SQL in your Supabase SQL editor:');
            console.log('   1. Go to: https://supabase.com/dashboard/project/uzamamymfzhelvkwpvgt/sql/new');
            console.log('   2. Copy and paste the SQL from the file above');
            console.log('   3. Click "Run" to create the trigger');
            
            return;
        }

        const result = await response.json();
        console.log('✅ Trigger created successfully!');
        console.log('Result:', result);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('\n📝 SQL script saved to: /home/neo/claude-tools/create-memory-sync-trigger.sql');
        console.log('\n⚠️  Please execute this SQL in your Supabase SQL editor:');
        console.log('   1. Go to: https://supabase.com/dashboard/project/uzamamymfzhelvkwpvgt/sql/new');
        console.log('   2. Copy and paste the SQL from the file');
        console.log('   3. Click "Run" to create the trigger');
    }
}

executeSql();