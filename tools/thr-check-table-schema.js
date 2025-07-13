#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function checkTableSchema() {
    console.log('🔍 Checking table schemas...\n');
    
    // Get one row from each table to see structure
    const tables = ['thr_leave_balances', 'thr_claims', 'thr_atlas_assets'];
    
    for (const table of tables) {
        console.log(`\n📋 Table: ${table}`);
        console.log('=' .repeat(40));
        
        // Try to insert a minimal record
        const testData = {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString()
        };
        
        const { data, error } = await supabase
            .from(table)
            .insert(testData)
            .select();
        
        if (error) {
            console.log('Insert error details:', JSON.stringify(error, null, 2));
            
            // Try to get columns info
            if (error.details) {
                console.log('Details:', error.details);
            }
            if (error.hint) {
                console.log('Hint:', error.hint);
            }
            if (error.message) {
                console.log('Message:', error.message);
            }
        } else {
            console.log('✅ Test insert successful');
            // Delete test record
            await supabase
                .from(table)
                .delete()
                .eq('id', testData.id);
        }
    }
}

// Use Node's built-in crypto
const crypto = require('crypto');

checkTableSchema().catch(console.error);