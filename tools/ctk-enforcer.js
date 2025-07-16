#!/usr/bin/env node

/**
 * CTK Enforcer - Prevents assumptions and enforces validation
 * This tool MUST be run before any data operations
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (question) => new Promise(resolve => rl.question(question, resolve));

class CTKEnforcer {
  constructor() {
    this.violations = [];
    this.checks = {
      memoryChecked: false,
      versionChecked: false,
      structureChecked: false,
      databaseVerified: false,
      assumptionsFlagged: false
    };
  }

  async enforceDataOperation(operation) {
    console.log('🛡️  CTK ENFORCER - Preventing Assumptions\n');
    console.log(`Operation: ${operation}\n`);

    // 1. Force Memory Check
    await this.enforceMemoryCheck(operation);

    // 2. Force Structure Verification
    await this.enforceStructureCheck();

    // 3. Force Assumption Declaration
    await this.enforceAssumptionCheck();

    // 4. Generate Validation Plan
    const plan = await this.generateValidationPlan(operation);

    // 5. Require User Approval
    const approved = await this.requireApproval(plan);

    if (!approved) {
      console.log('\n❌ Operation BLOCKED by CTK Enforcer');
      process.exit(1);
    }

    // 6. Save enforcement record
    await this.saveEnforcementRecord(operation, plan);

    console.log('\n✅ CTK Validation Complete - Operation Allowed\n');
    return plan;
  }

  async enforceMemoryCheck(operation) {
    console.log('📋 Step 1: Memory Check\n');
    
    const searchTerms = [
      operation.split(' ')[0], // First word (e.g., "migration")
      'assumption',
      'corruption',
      'failed'
    ];

    console.log('Searching memories for:', searchTerms.join(', '));
    
    // Simulate memory search (in real implementation, would call memory search)
    const answer = await ask('Have you searched memories for related operations? (yes/no): ');
    
    if (answer.toLowerCase() !== 'yes') {
      this.violations.push('Memory check not performed');
      console.log('❌ VIOLATION: Must search memories first!');
      console.log('\nRun: node ~/claude-tools/search-memory.js "' + searchTerms[0] + '"\n');
      process.exit(1);
    }

    this.checks.memoryChecked = true;
  }

  async enforceStructureCheck() {
    console.log('\n📋 Step 2: Structure Verification\n');
    
    const checks = [
      'Read source data format',
      'Verified destination schema',
      'Checked existing data',
      'Validated relationships'
    ];

    for (const check of checks) {
      const answer = await ask(`${check}? (yes/no): `);
      if (answer.toLowerCase() !== 'yes') {
        this.violations.push(`Structure check failed: ${check}`);
      }
    }

    if (this.violations.length > 0) {
      console.log('\n❌ VIOLATIONS:', this.violations.join('\n'));
      process.exit(1);
    }

    this.checks.structureChecked = true;
  }

  async enforceAssumptionCheck() {
    console.log('\n📋 Step 3: Assumption Declaration\n');
    
    console.log('List ALL assumptions you are making:');
    console.log('(Enter each assumption, empty line when done)\n');
    
    const assumptions = [];
    while (true) {
      const assumption = await ask('Assumption: ');
      if (!assumption.trim()) break;
      assumptions.push(assumption);
    }

    if (assumptions.length === 0) {
      console.log('✅ No assumptions declared - good!');
    } else {
      console.log('\n⚠️  ASSUMPTIONS DETECTED:');
      assumptions.forEach((a, i) => console.log(`   ${i + 1}. ${a}`));
      
      const confirm = await ask('\nHave you verified each assumption? (yes/no): ');
      if (confirm.toLowerCase() !== 'yes') {
        console.log('❌ VIOLATION: Unverified assumptions!');
        process.exit(1);
      }
    }

    this.checks.assumptionsFlagged = true;
    this.assumptions = assumptions;
  }

  async generateValidationPlan(operation) {
    console.log('\n📋 Step 4: Generating Validation Plan\n');
    
    const plan = {
      operation,
      timestamp: new Date().toISOString(),
      checks: this.checks,
      assumptions: this.assumptions || [],
      validations: [
        'Preview first 5 records before bulk operation',
        'Verify foreign key relationships',
        'Check for duplicate records',
        'Validate data types match',
        'Ensure no phantom IDs',
        'Create rollback checkpoint'
      ],
      rollback: {
        method: 'Transaction with savepoint',
        backupRequired: true
      }
    };

    console.log('Validation Plan:');
    console.log(JSON.stringify(plan, null, 2));

    return plan;
  }

  async requireApproval(plan) {
    console.log('\n📋 Step 5: User Approval Required\n');
    
    console.log('⚠️  CRITICAL CHECKPOINTS:');
    console.log('1. All source data has been read and understood');
    console.log('2. Destination schema has been verified');
    console.log('3. Sample data will be shown before bulk operations');
    console.log('4. Rollback plan is in place');
    console.log('5. No assumptions remain unverified\n');

    const answer = await ask('Do you approve this operation? (yes/no): ');
    return answer.toLowerCase() === 'yes';
  }

  async saveEnforcementRecord(operation, plan) {
    const record = {
      ...plan,
      enforced: true,
      timestamp: new Date().toISOString()
    };

    const recordPath = path.join(__dirname, '../enforcement-logs');
    if (!fs.existsSync(recordPath)) {
      fs.mkdirSync(recordPath, { recursive: true });
    }

    const filename = `enforcement-${Date.now()}.json`;
    fs.writeFileSync(
      path.join(recordPath, filename),
      JSON.stringify(record, null, 2)
    );

    console.log(`\n📝 Enforcement record saved: ${filename}`);

    // Also save to memory
    console.log('\n💾 Saving to CTK memory...');
    const memoryCmd = `node ~/claude-tools/save-memory.js "CTK-Enforcement" "${operation}" "${JSON.stringify(record).replace(/"/g, '\\"')}" 8`;
    
    try {
      execSync(memoryCmd, { stdio: 'inherit' });
    } catch (e) {
      console.log('Warning: Could not save to memory');
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node ctk-enforcer.js "operation description"');
    console.log('Example: node ctk-enforcer.js "THR data migration from CSV"');
    process.exit(1);
  }

  const operation = args.join(' ');
  const enforcer = new CTKEnforcer();
  
  try {
    await enforcer.enforceDataOperation(operation);
  } catch (error) {
    console.error('❌ Enforcement Error:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();