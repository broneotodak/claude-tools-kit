#!/usr/bin/env node

/**
 * Query THR (Human Resource Management System) data
 * Since the main Supabase instance has access to all TODAK databases
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function queryTHR(table, options = {}) {
  try {
    console.log(`📊 Querying THR table: ${table}\n`);
    
    // Build query
    let query = supabase.from(table).select(options.select || '*');
    
    // Add filters if provided
    if (options.filter) {
      Object.entries(options.filter).forEach(([key, value]) => {
        query = query.eq(key, value);
      });
    }
    
    // Add limit
    if (options.limit) {
      query = query.limit(options.limit);
    }
    
    // Add ordering
    if (options.orderBy) {
      query = query.order(options.orderBy, { ascending: options.ascending ?? false });
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('❌ Query error:', error.message);
      return;
    }
    
    if (!data || data.length === 0) {
      console.log('No data found');
      return;
    }
    
    console.log(`Found ${data.length} records\n`);
    
    // Display results
    if (options.format === 'json') {
      console.log(JSON.stringify(data, null, 2));
    } else {
      // Table format
      data.forEach((record, index) => {
        console.log(`Record ${index + 1}:`);
        Object.entries(record).forEach(([key, value]) => {
          if (value !== null && value !== '') {
            console.log(`  ${key}: ${value}`);
          }
        });
        console.log('');
      });
    }
    
    return data;
  } catch (error) {
    console.error('❌ Error querying THR:', error.message);
  }
}

// List available THR tables
async function listTHRTables() {
  try {
    console.log('🔍 Searching for THR tables...\n');
    
    // Common THR table patterns
    const patterns = ['thr_', 'employee', 'salary', 'department', 'attendance'];
    const tables = new Set();
    
    // Try to query information_schema (if accessible)
    const { data, error } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', patterns.map(p => `%${p}%`));
    
    if (error) {
      // Fallback: try known THR tables
      console.log('Using known THR tables list:\n');
      const knownTables = [
        'thr_employees',
        'thr_salaries', 
        'thr_departments',
        'thr_organizations',
        'employees',
        'employee_master',
        'salary_records'
      ];
      
      for (const table of knownTables) {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });
        
        if (!error) {
          tables.add(table);
          console.log(`✓ ${table} (${count} records)`);
        }
      }
    } else {
      data.forEach(row => {
        tables.add(row.table_name);
        console.log(`✓ ${row.table_name}`);
      });
    }
    
    if (tables.size === 0) {
      console.log('No THR tables found');
    }
    
    return Array.from(tables);
  } catch (error) {
    console.error('❌ Error listing tables:', error.message);
  }
}

// Run if called directly
if (require.main === module) {
  const command = process.argv[2];
  
  if (!command || command === 'help') {
    console.log('THR Query Tool - Access THR database through CTK\n');
    console.log('Usage:');
    console.log('  ./query-thr.js list                    - List available THR tables');
    console.log('  ./query-thr.js <table> [options]       - Query a specific table');
    console.log('');
    console.log('Options:');
    console.log('  --select <fields>   - Comma-separated fields to select');
    console.log('  --limit <n>         - Limit results');
    console.log('  --filter <k=v>      - Filter by field=value');
    console.log('  --orderBy <field>   - Order by field');
    console.log('  --json              - Output as JSON');
    console.log('');
    console.log('Examples:');
    console.log('  ./query-thr.js list');
    console.log('  ./query-thr.js thr_employees --limit 5');
    console.log('  ./query-thr.js employees --filter "department=IT" --select "name,email"');
    process.exit(0);
  }
  
  if (command === 'list') {
    listTHRTables();
  } else {
    // Parse options
    const options = {
      limit: 10,
      format: 'table'
    };
    
    for (let i = 3; i < process.argv.length; i += 2) {
      const flag = process.argv[i];
      const value = process.argv[i + 1];
      
      switch (flag) {
        case '--select':
          options.select = value;
          break;
        case '--limit':
          options.limit = parseInt(value);
          break;
        case '--filter':
          const [key, val] = value.split('=');
          options.filter = options.filter || {};
          options.filter[key] = val;
          break;
        case '--orderBy':
          options.orderBy = value;
          break;
        case '--json':
          options.format = 'json';
          i--; // No value for this flag
          break;
      }
    }
    
    queryTHR(command, options);
  }
}

module.exports = { queryTHR, listTHRTables };