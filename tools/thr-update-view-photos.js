#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

// Load environment
require('dotenv').config();

if (!process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SERVICE ROLE KEY required. Add to .env file.');
    process.exit(1);
}

const supabase = createClient(
    process.env.ATLAS_SUPABASE_URL,
    process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function updateView() {
    console.log('🔄 Updating thr_employees_view with photo fields...\n');
    
    const sql = fs.readFileSync(
        path.join(__dirname, 'thr-update-view-with-photos.sql'),
        'utf8'
    );
    
    try {
        // Execute using the SQL editor endpoint
        const response = await fetch(
            `${process.env.ATLAS_SUPABASE_URL}/rest/v1/rpc/execute_sql`,
            {
                method: 'POST',
                headers: {
                    'apikey': process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY,
                    'Authorization': `Bearer ${process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sql_query: sql }),
            }
        );
        
        if (!response.ok) {
            // If direct SQL doesn't work, show manual instructions
            console.log('⚠️  Cannot execute SQL directly. Please run this in Supabase SQL Editor:');
            console.log('\n1. Go to: https://supabase.com/dashboard/project/ftbtsxlujsnobujwekwx/sql/new');
            console.log('2. Copy and paste the SQL from:');
            console.log('   /Users/broneotodak/Projects/claude-tools-kit/tools/thr-update-view-with-photos.sql');
            console.log('3. Click "Run"');
            console.log('\n✨ This will add photo_url and thumbnail_url to the view');
            return;
        }
        
        console.log('✅ View updated successfully!');
    } catch (error) {
        console.error('Error:', error.message);
        console.log('\n📝 Manual update required - see instructions above');
    }
}

updateView().catch(console.error);