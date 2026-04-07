#!/usr/bin/env node

/**
 * THR Schema Explorer - Understand Lan's database design
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.THR_SUPABASE_URL,
  process.env.THR_SUPABASE_SERVICE_ROLE_KEY
);

async function getAllTables() {
  try {
    // Query information schema for all tables
    const { data, error } = await supabase
      .rpc('get_tables_info', {})
      .select('*');
      
    if (error) {
      // Fallback to manual discovery
      console.log('Using manual table discovery...\n');
      
      const tables = [
        // Known tables
        'users', 'employees', 'organizations', 'brands',
        // Potential THR tables
        'thr_staff', 'thr_salaries', 'thr_attendance', 'thr_leaves',
        'thr_departments', 'thr_designations', 'thr_grades',
        'thr_allowances', 'thr_deductions', 'thr_payroll',
        'thr_overtime', 'thr_claims', 'thr_loans',
        // Other potential tables
        'departments', 'designations', 'grades', 'salaries',
        'attendance', 'leaves', 'allowances', 'deductions',
        'payroll', 'overtime', 'claims', 'loans',
        'employee_grades', 'employee_designations',
        'organization_departments', 'staff_roles'
      ];
      
      const foundTables = [];
      
      for (const table of tables) {
        try {
          const { count, error } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true });
            
          if (!error) {
            foundTables.push({ name: table, count });
          }
        } catch (e) {
          // Table doesn't exist
        }
      }
      
      return foundTables.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    return data;
  } catch (error) {
    console.error('Error getting tables:', error);
    return [];
  }
}

async function getTableColumns(tableName) {
  try {
    // Get one row to inspect columns
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .limit(1);
      
    if (error) return null;
    
    if (data && data.length > 0) {
      return Object.keys(data[0]);
    }
    
    // If no data, try another method
    return null;
  } catch (error) {
    return null;
  }
}

async function getTableRelationships(tableName) {
  const columns = await getTableColumns(tableName);
  if (!columns) return [];
  
  const relationships = [];
  
  // Look for foreign key patterns
  for (const col of columns) {
    if (col.endsWith('_id') && col !== 'id') {
      const relatedTable = col.replace('_id', '');
      relationships.push({
        column: col,
        possibleTable: relatedTable,
        type: 'foreign_key'
      });
    }
    
    // Special cases
    if (col === 'user_id') {
      relationships.push({
        column: col,
        possibleTable: 'users',
        type: 'foreign_key'
      });
    }
  }
  
  return relationships;
}

async function analyzeUsersTable() {
  console.log('\n📊 Analyzing Users Table Structure...\n');
  
  const columns = await getTableColumns('users');
  if (columns) {
    console.log('Users table columns:', columns.join(', '));
  }
  
  // Check what tables reference users
  const allTables = await getAllTables();
  const referencingTables = [];
  
  for (const table of allTables) {
    const cols = await getTableColumns(table.name);
    if (cols && cols.includes('user_id')) {
      referencingTables.push(table.name);
    }
  }
  
  console.log('\nTables that reference users:', referencingTables.join(', '));
}

async function exploreThrStaff() {
  console.log('\n🔍 Exploring thr_staff table...\n');
  
  const { data, error } = await supabase
    .from('thr_staff')
    .select('*')
    .limit(5);
    
  if (error) {
    console.log('thr_staff table not found or error:', error.message);
    return;
  }
  
  if (data && data.length > 0) {
    console.log('thr_staff sample structure:');
    console.log('Columns:', Object.keys(data[0]).join(', '));
    console.log(`\nFound ${data.length} records`);
    
    // Check if it has auth-related fields
    const authFields = ['email', 'password', 'auth_id', 'user_id'];
    const hasAuthFields = authFields.filter(f => Object.keys(data[0]).includes(f));
    console.log('Auth-related fields:', hasAuthFields.join(', ') || 'None');
  }
}

async function mapBrandOrgRelationship() {
  console.log('\n🏢 Mapping Brand-Organization Relationship...\n');
  
  // Check if brands table exists
  const { data: brands, error: brandError } = await supabase
    .from('brands')
    .select('*');
    
  if (!brandError && brands) {
    console.log(`Found ${brands.length} brands`);
    
    // Get organizations with brand info
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name, branch, brand_id')
      .limit(5);
      
    if (orgs) {
      console.log('\nSample organization-brand mapping:');
      orgs.forEach(org => {
        console.log(`  ${org.name} (${org.branch}) -> brand_id: ${org.brand_id}`);
      });
    }
  } else {
    console.log('Brands table not found');
  }
}

async function generateSchemaReport() {
  console.log('🔍 THR Schema Explorer\n');
  console.log('=' .repeat(50));
  
  // 1. Get all tables
  console.log('\n📋 ALL TABLES:\n');
  const tables = await getAllTables();
  
  for (const table of tables) {
    const count = table.count !== null ? `${table.count} records` : 'unknown count';
    console.log(`  • ${table.name} (${count})`);
  }
  
  // 2. Analyze each table's relationships
  console.log('\n🔗 TABLE RELATIONSHIPS:\n');
  for (const table of tables) {
    const relationships = await getTableRelationships(table.name);
    if (relationships.length > 0) {
      console.log(`${table.name}:`);
      relationships.forEach(rel => {
        console.log(`  └─ ${rel.column} -> ${rel.possibleTable}`);
      });
      console.log('');
    }
  }
  
  // 3. Specific analysis
  await analyzeUsersTable();
  await exploreThrStaff();
  await mapBrandOrgRelationship();
  
  // 4. Summary
  console.log('\n📊 SUMMARY:\n');
  console.log(`Total tables found: ${tables.length}`);
  const thrTables = tables.filter(t => t.name.startsWith('thr_'));
  console.log(`THR-specific tables: ${thrTables.length}`);
  console.log(`THR tables:`, thrTables.map(t => t.name).join(', '));
}

// Run if called directly
if (require.main === module) {
  generateSchemaReport().catch(console.error);
}

module.exports = {
  getAllTables,
  getTableColumns,
  getTableRelationships,
  analyzeUsersTable
};