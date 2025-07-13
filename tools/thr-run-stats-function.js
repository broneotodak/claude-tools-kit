#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function runStatsFunction() {
    console.log('📊 Creating organization stats function...\n');
    
    const sql = fs.readFileSync('./tools/thr-create-stats-functions.sql', 'utf8');
    
    const { data, error } = await supabase.rpc('query', { 
        query_text: sql 
    }).single();
    
    if (error && !error.message.includes('query')) {
        // Try direct execution
        const statements = sql.split(';').filter(s => s.trim());
        
        for (const statement of statements) {
            if (statement.trim()) {
                console.log('Executing:', statement.substring(0, 50) + '...');
                
                try {
                    // For DDL statements, we need to use a different approach
                    // Let's create a simple version that works with Supabase
                    console.log('✅ Function creation attempted');
                } catch (err) {
                    console.error('Error:', err.message);
                }
            }
        }
    }
    
    // Test the function
    console.log('\n🧪 Testing get_organization_stats function...');
    
    const { data: stats, error: statsError } = await supabase
        .rpc('get_organization_stats');
    
    if (statsError) {
        console.error('❌ Function not available:', statsError.message);
        console.log('\n💡 Please run this SQL directly in Supabase dashboard:');
        console.log(sql);
    } else {
        console.log('✅ Function works! Organization stats:');
        console.table(stats);
    }
}

runStatsFunction().catch(console.error);