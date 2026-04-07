#!/usr/bin/env node

/**
 * THR Summary Report
 * Shows complete overview of THR data
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.ATLAS_SUPABASE_URL,
  process.env.ATLAS_SUPABASE_SERVICE_ROLE_KEY
);

async function generateReport() {
  console.log('📊 THR DATABASE SUMMARY REPORT\n');
  console.log('=' .repeat(60));
  console.log(`Generated: ${new Date().toLocaleString()}`);
  console.log('=' .repeat(60));
  
  // 1. Organizations Overview
  console.log('\n1. ORGANIZATIONS & BRANDS\n');
  
  const { data: brands } = await supabase
    .from('thr_brands')
    .select('*')
    .order('name');
  
  console.log('Brands:');
  brands.forEach(brand => {
    console.log(`  • ${brand.name} (${brand.brand_id})`);
  });
  
  const { data: orgs } = await supabase
    .from('thr_organizations')
    .select('*, thr_brands(name)')
    .order('organization_code');
  
  console.log('\nOrganizations:');
  console.log('Code  | Organization Name                    | Brand         | Active');
  console.log('------|-------------------------------------|---------------|-------');
  orgs.forEach(org => {
    console.log(
      `${org.organization_code.padEnd(5)} | ` +
      `${org.name.padEnd(35)} | ` +
      `${(org.thr_brands?.name || 'Unknown').padEnd(13)} | ` +
      `${org.is_active ? '✓' : '✗'}`
    );
  });
  
  // 2. Employee Data Overview
  console.log('\n\n2. EMPLOYEE DATA IN master_hr2000\n');
  
  const { data: employeeStats } = await supabase
    .from('master_hr2000')
    .select('branch, active_status');
  
  const stats = {};
  let totalActive = 0;
  let totalInactive = 0;
  
  employeeStats.forEach(emp => {
    if (!stats[emp.branch]) {
      stats[emp.branch] = { active: 0, inactive: 0, total: 0 };
    }
    stats[emp.branch].total++;
    if (emp.active_status) {
      stats[emp.branch].active++;
      totalActive++;
    } else {
      stats[emp.branch].inactive++;
      totalInactive++;
    }
  });
  
  console.log('Branch | Total | Active | Inactive | Active %');
  console.log('-------|-------|--------|----------|----------');
  
  Object.entries(stats)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([branch, data]) => {
      const activePercent = ((data.active / data.total) * 100).toFixed(1);
      console.log(
        `${branch.padEnd(6)} | ` +
        `${data.total.toString().padEnd(5)} | ` +
        `${data.active.toString().padEnd(6)} | ` +
        `${data.inactive.toString().padEnd(8)} | ` +
        `${activePercent}%`
      );
    });
  
  console.log('-------|-------|--------|----------|----------');
  console.log(
    `${'TOTAL'.padEnd(6)} | ` +
    `${employeeStats.length.toString().padEnd(5)} | ` +
    `${totalActive.toString().padEnd(6)} | ` +
    `${totalInactive.toString().padEnd(8)} | ` +
    `${((totalActive / employeeStats.length) * 100).toFixed(1)}%`
  );
  
  // 3. Data Quality Check
  console.log('\n\n3. DATA QUALITY CHECK\n');
  
  const { data: quality } = await supabase
    .from('master_hr2000')
    .select('employee_name, ic_no, company_email, mobile, bank_acc_no');
  
  const qualityStats = {
    hasName: quality.filter(e => e.employee_name && e.employee_name !== '').length,
    hasIC: quality.filter(e => e.ic_no && e.ic_no !== '').length,
    hasEmail: quality.filter(e => e.company_email && e.company_email !== '').length,
    hasMobile: quality.filter(e => e.mobile && e.mobile !== '').length,
    hasBank: quality.filter(e => e.bank_acc_no && e.bank_acc_no !== '').length
  };
  
  console.log('Field Completeness:');
  Object.entries(qualityStats).forEach(([field, count]) => {
    const percent = ((count / quality.length) * 100).toFixed(1);
    console.log(`  ${field.padEnd(10)}: ${count}/${quality.length} (${percent}%)`);
  });
  
  // 4. Recent Imports
  console.log('\n\n4. IMPORT HISTORY\n');
  
  const { data: recent } = await supabase
    .from('master_hr2000')
    .select('created_at, data_source')
    .order('created_at', { ascending: false })
    .limit(10);
  
  console.log('Recent imports:');
  const importDates = {};
  recent.forEach(rec => {
    const date = new Date(rec.created_at).toLocaleDateString();
    if (!importDates[date]) importDates[date] = new Set();
    importDates[date].add(rec.data_source);
  });
  
  Object.entries(importDates).forEach(([date, sources]) => {
    console.log(`  ${date}: ${Array.from(sources).join(', ')}`);
  });
  
  // 5. Table Status
  console.log('\n\n5. TABLE STATUS\n');
  
  const tables = [
    'master_hr2000',
    'thr_employees',
    'thr_brands',
    'thr_organizations'
  ];
  
  for (const table of tables) {
    const { count } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    console.log(`  ${table.padEnd(20)}: ${count} records`);
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('✅ Report generated successfully');
}

async function main() {
  try {
    await generateReport();
  } catch (error) {
    console.error('❌ Error generating report:', error.message);
  }
}

if (require.main === module) {
  main().catch(console.error);
}