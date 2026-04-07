#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config({ path: '/Users/broneotodak/Projects/claude-tools-kit/.env' });

// Memory/PGVector database credentials
const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function executeGridMemorySQL() {
    try {
        console.log('🚀 Executing Grid Memory Table Creation SQL...\n');
        
        // Read the SQL file
        const sqlFilePath = '/Users/broneotodak/Projects/THR/sql/create-grid-memory-table.sql';
        const sql = fs.readFileSync(sqlFilePath, 'utf8');
        
        console.log('📁 SQL file read successfully');
        console.log('📊 Database: uzamamymfzhelvkwpvgt.supabase.co (PGVector Memory)');
        console.log('🔨 Creating claude_grid_memory table...\n');
        
        // Split SQL into individual statements and filter out comments and empty lines
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s && !s.startsWith('--') && s !== '\n');
        
        console.log(`📝 Found ${statements.length} SQL statements to execute\n`);
        
        // Execute each statement individually
        let successCount = 0;
        let errors = [];
        
        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i].trim();
            if (!stmt) continue;
            
            // Skip DO blocks as they're just notices
            if (stmt.startsWith('DO $$')) {
                console.log(`⏭️  Skipping notice statement ${i + 1}`);
                continue;
            }
            
            console.log(`🔄 Executing statement ${i + 1}/${statements.length}...`);
            console.log(`   Preview: ${stmt.substring(0, 60)}${stmt.length > 60 ? '...' : ''}`);
            
            try {
                const { data, error } = await supabase.rpc('exec_sql', { 
                    sql: stmt + ';'
                });
                
                if (error) {
                    console.log(`   ❌ Error: ${error.message}`);
                    errors.push(`Statement ${i + 1}: ${error.message}`);
                } else {
                    console.log(`   ✅ Success`);
                    successCount++;
                }
            } catch (err) {
                console.log(`   ❌ Exception: ${err.message}`);
                errors.push(`Statement ${i + 1}: ${err.message}`);
            }
            
            // Small delay to avoid overwhelming the API
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('\n📊 Execution Summary:');
        console.log(`   ✅ Successful statements: ${successCount}`);
        console.log(`   ❌ Failed statements: ${errors.length}`);
        
        if (errors.length > 0) {
            console.log('\n❌ Errors encountered:');
            errors.forEach(err => console.log(`   - ${err}`));
            console.log('\n⚠️  Some statements failed. Please check the Supabase dashboard for partial creation.');
        } else {
            console.log('\n🎉 All statements executed successfully!');
        }
        
        // Verify table creation
        console.log('\n🔍 Verifying table creation...');
        try {
            const { data, error } = await supabase
                .from('claude_grid_memory')
                .select('count', { count: 'exact', head: true });
            
            if (!error) {
                console.log('✅ claude_grid_memory table created successfully!');
                console.log('🆔 Table exists and is accessible');
            } else {
                console.log(`❌ Verification failed: ${error.message}`);
            }
        } catch (err) {
            console.log(`❌ Verification error: ${err.message}`);
        }
        
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('   1. Check PGVector database credentials in .env');
        console.log('   2. Ensure service role key has sufficient permissions');
        console.log('   3. Verify exec_sql function exists in the database');
        console.log('\n📝 Manual execution option:');
        console.log('   1. Go to: https://supabase.com/dashboard/project/uzamamymfzhelvkwpvgt/sql/new');
        console.log('   2. Copy and paste the SQL from: /Users/broneotodak/Projects/THR/sql/create-grid-memory-table.sql');
        console.log('   3. Click "Run" to create the table');
    }
}

// Run the script
executeGridMemorySQL();