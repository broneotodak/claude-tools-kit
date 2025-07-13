#!/usr/bin/env node

/**
 * Query any Supabase project using project URL and service key
 * Useful for accessing THR, ATLAS, and other TODAK projects
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Known TODAK Supabase projects
const KNOWN_PROJECTS = {
  'ctk': {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    description: 'CTK/Claude Desktop Memory (PGVector)'
  },
  'todak-ai': {
    url: 'https://uzamamymfzhelvkwpvgt.supabase.co',
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    description: 'TODAK AI Main System'
  },
  'thr': {
    url: process.env.THR_SUPABASE_URL || 'https://aiazdgohytygipiddbtp.supabase.co',
    key: process.env.THR_SUPABASE_SERVICE_ROLE_KEY,
    description: 'THR - Human Resource Management System (Old)'
  },
  'atlas': {
    url: process.env.ATLAS_SUPABASE_URL || 'https://ftbtsxlujsnobujwekwx.supabase.co',
    key: process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY,
    description: 'ATLAS/THR - Asset Tracking & HR Shared Database'
  }
  // Add more projects as we discover them
};

async function queryProject(projectUrl, serviceKey, table, query = {}) {
  try {
    const supabase = createClient(projectUrl, serviceKey);
    
    console.log(`📊 Querying table: ${table}`);
    console.log(`🌐 Project: ${projectUrl}\n`);
    
    // Build query
    let supabaseQuery = supabase.from(table).select(query.select || '*');
    
    // Add filters
    if (query.filter) {
      Object.entries(query.filter).forEach(([key, value]) => {
        supabaseQuery = supabaseQuery.eq(key, value);
      });
    }
    
    // Add limit
    if (query.limit) {
      supabaseQuery = supabaseQuery.limit(query.limit);
    }
    
    // Add ordering
    if (query.orderBy) {
      supabaseQuery = supabaseQuery.order(query.orderBy, { ascending: query.ascending ?? false });
    }
    
    const { data, error, count } = await supabaseQuery;
    
    if (error) {
      console.error('❌ Query error:', error.message);
      return null;
    }
    
    console.log(`✅ Found ${data?.length || 0} records\n`);
    
    // Display results
    if (query.format === 'json') {
      console.log(JSON.stringify(data, null, 2));
    } else if (data && data.length > 0) {
      data.forEach((record, index) => {
        console.log(`Record ${index + 1}:`);
        Object.entries(record).forEach(([key, value]) => {
          if (value !== null && value !== '' && key !== 'embedding') {
            const displayValue = typeof value === 'object' ? JSON.stringify(value) : value;
            console.log(`  ${key}: ${displayValue}`);
          }
        });
        console.log('');
      });
    }
    
    return data;
  } catch (error) {
    console.error('❌ Error:', error.message);
    return null;
  }
}

async function listTables(projectUrl, serviceKey) {
  try {
    const supabase = createClient(projectUrl, serviceKey);
    
    console.log(`🔍 Listing tables in project...`);
    console.log(`🌐 Project: ${projectUrl}\n`);
    
    // Try to get tables from pg_tables
    const { data, error } = await supabase
      .from('pg_tables')
      .select('tablename')
      .eq('schemaname', 'public');
    
    if (error) {
      // Try alternative method
      console.log('Trying alternative method...\n');
      
      // List of common table names to probe
      const commonTables = [
        'claude_desktop_memory', 'memories', 'users', 'profiles',
        'employees', 'thr_employees', 'employee_master', 
        'departments', 'thr_departments', 'organizations',
        'salaries', 'thr_salaries', 'salary_records',
        'assets', 'atlas_assets', 'inventory',
        'projects', 'tasks', 'activities'
      ];
      
      const foundTables = [];
      
      for (const table of commonTables) {
        const { error } = await supabase
          .from(table)
          .select('*')
          .limit(1);
        
        if (!error) {
          foundTables.push(table);
        }
      }
      
      if (foundTables.length > 0) {
        console.log('Found tables:');
        foundTables.forEach(table => console.log(`  ✓ ${table}`));
      } else {
        console.log('No accessible tables found');
      }
      
      return foundTables;
    }
    
    if (data && data.length > 0) {
      console.log('Public tables:');
      data.forEach(row => console.log(`  ✓ ${row.tablename}`));
      return data.map(row => row.tablename);
    }
    
    return [];
  } catch (error) {
    console.error('❌ Error listing tables:', error.message);
    return [];
  }
}

// Interactive project discovery
async function discoverProject(hint) {
  console.log(`🔍 Searching for project: ${hint}\n`);
  
  // Check if it's a known project alias
  if (KNOWN_PROJECTS[hint.toLowerCase()]) {
    const project = KNOWN_PROJECTS[hint.toLowerCase()];
    console.log(`✅ Found known project: ${project.description}`);
    console.log(`URL: ${project.url}`);
    return project;
  }
  
  // Try common Supabase URL patterns
  const patterns = [
    `https://${hint}.supabase.co`,
    `https://${hint.toLowerCase()}.supabase.co`,
    hint // If already a full URL
  ];
  
  console.log('Trying URL patterns...');
  for (const url of patterns) {
    if (url.includes('supabase.co')) {
      console.log(`  Testing: ${url}`);
      // We can't actually test without a key, but return the URL
      return { url, key: null };
    }
  }
  
  console.log('\n❌ Project not found. You may need to provide the full URL and key.');
  return null;
}

// Main CLI
if (require.main === module) {
  const command = process.argv[2];
  
  if (!command || command === 'help') {
    console.log('Supabase Project Query Tool\n');
    console.log('Usage:');
    console.log('  query-supabase-project.js list-projects       - List known projects');
    console.log('  query-supabase-project.js discover <hint>     - Find project by name/hint');
    console.log('  query-supabase-project.js <url> <key> list    - List tables in project');
    console.log('  query-supabase-project.js <url> <key> <table> - Query specific table');
    console.log('');
    console.log('Known project shortcuts:');
    Object.entries(KNOWN_PROJECTS).forEach(([alias, project]) => {
      console.log(`  ${alias} - ${project.description}`);
    });
    console.log('');
    console.log('Examples:');
    console.log('  ./query-supabase-project.js list-projects');
    console.log('  ./query-supabase-project.js discover thr');
    console.log('  ./query-supabase-project.js ctk claude_desktop_memory --limit 5');
    process.exit(0);
  }
  
  if (command === 'list-projects') {
    console.log('Known TODAK Supabase Projects:\n');
    Object.entries(KNOWN_PROJECTS).forEach(([alias, project]) => {
      console.log(`${alias}:`);
      console.log(`  Description: ${project.description}`);
      console.log(`  URL: ${project.url}`);
      console.log(`  Key: ${project.key ? '✓ Available' : '❌ Not configured'}`);
      console.log('');
    });
  } else if (command === 'discover') {
    const hint = process.argv[3];
    if (!hint) {
      console.error('Please provide a project hint');
      process.exit(1);
    }
    discoverProject(hint);
  } else {
    // Check if using project alias
    const projectAlias = KNOWN_PROJECTS[command];
    let url, key, table;
    
    if (projectAlias) {
      url = projectAlias.url;
      key = projectAlias.key;
      table = process.argv[3];
    } else {
      url = command;
      key = process.argv[3];
      table = process.argv[4];
    }
    
    if (!table || table === 'list') {
      // List tables
      if (projectAlias) {
        listTables(url, projectAlias.key);
      } else if (key) {
        listTables(url, key);
      } else {
        console.error('Service key required');
        process.exit(1);
      }
    } else if (!table) {
      // List tables for custom project
      listTables(url, key);
    } else {
      // Query table
      const options = { limit: 10 };
      
      // Parse additional options
      for (let i = (projectAlias ? 4 : 5); i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg.startsWith('--')) {
          const [flag, value] = arg.split('=');
          switch (flag) {
            case '--limit':
              options.limit = parseInt(value);
              break;
            case '--json':
              options.format = 'json';
              break;
          }
        }
      }
      
      queryProject(url, key, table, options);
    }
  }
}

module.exports = { queryProject, listTables, discoverProject };