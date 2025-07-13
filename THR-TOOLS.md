# THR Migration Tools Documentation

This directory contains all the tools created for migrating data from HR2000 to the new THR (Todak Human Resources) system.

## Overview

The THR migration involved processing 518 employee records from various data sources (text files, CSV, raw dumps) and creating a clean, normalized database structure.

## Tool Categories

### 1. Parser Tools
- `thr-hr2000-parser.js` - Main parser for HR2000 data
- `thr-txt-analyzer.js` - Analyzes text file formats
- `thr-txt-parser-v2.js` - Enhanced text parser
- `thr-txt-parser-fixed.js` - Fixed width text parser

### 2. Import Tools
- `thr-comprehensive-import.js` - Full data import orchestrator
- `thr-batch-import.js` - Batch import for large datasets
- `thr-simple-import.js` - Basic import functionality
- `thr-test-import.js` - Import testing tool

### 3. Migration Tools (Field-specific)
- `thr-migrate-employees.js` - Main employee migration
- `thr-migrate-spouse-details.js` - Spouse information
- `thr-migrate-perkeso-code.js` - PERKESO/SOCSO codes
- `thr-migrate-kwsp-rates.js` - EPF contribution rates
- `thr-migrate-eis-rates.js` - EIS rates
- `thr-migrate-socso-contributions.js` - SOCSO contributions
- `thr-migrate-ea-form.js` - EA tax forms
- `thr-migrate-fixed-allowances.js` - Fixed allowances
- `thr-migrate-allowances.js` - Variable allowances

### 4. Fix Tools (Data Cleanup)
- `thr-fix-missing-names.js` - Handle missing employee names
- `thr-fix-allowances.js` - Fix allowance data
- `thr-fix-deductions.js` - Fix deduction data
- `thr-fix-demographics.js` - Fix demographic info
- `thr-fix-employment-date.js` - Fix employment dates
- `thr-fix-bank-branch.js` - Fix bank details
- `thr-fix-statutory-deductions.js` - Fix statutory deductions

### 5. Schema Tools
- `thr-rebuild-schema.js` - Rebuild clean schema
- `thr-create-complete-schema.js` - Create full THR schema
- `thr-create-functions.sql` - Database functions
- `thr-add-allowances-column.sql` - Schema modifications
- `thr-add-resign-date.sql` - Add resignation dates

### 6. Analysis Tools
- `thr-comprehensive-analyzer.js` - Full data analysis
- `thr-auth-analyzer.js` - Authentication analysis
- `thr-data-check.js` - Data quality checks
- `thr-check-organizations.js` - Organization mapping
- `thr-summary-report.js` - Migration summary

### 7. Cleanup Tools
- `thr-cleanup-phase1.js` through `thr-cleanup-phase4.js` - Phased cleanup
- `thr-final-cleanup.js` - Final cleanup operations
- `thr-remove-columns-safely.js` - Safe column removal
- `thr-backup-before-cleanup.js` - Pre-cleanup backup

## Database Structure

### Core Tables (with proper prefixes)
- `thr_employees` - Main employee table (master data source)
- `thr_brands` - Company brands
- `thr_organizations` - Organizations under brands
- `thr_departments` - Departments
- `thr_sections` - Sections within departments
- `thr_positions` - Job positions

### HR Module Tables
- `thr_employment_history` - Employment records
- `thr_leave_records` - Leave management
- `thr_payroll_records` - Payroll data
- `thr_allowance_types` - Allowance definitions
- `thr_deduction_types` - Deduction definitions
- `thr_employee_allowances` - Employee-specific allowances
- `thr_employee_deductions` - Employee-specific deductions

### Future Module Tables
- Accounting: `thr_acc_*` prefix
- ATLAS: `thr_atlas_*` prefix

## Usage

All tools require environment variables:
```bash
ATLAS_SUPABASE_URL=your_supabase_url
ATLAS_SUPABASE_SERVICE_ROLE_KEY=your_service_key
```

Run any tool:
```bash
node tools/thr-migrate-employees.js
```

## Migration Status

✅ Completed:
- All 518 employees migrated
- Reference data populated (46 departments, 183 positions)
- JSONB fields for flexible data storage
- Authentication support ready

🔄 Pending:
- Organization mapping
- Auth.users integration
- Accounting module tables
- ATLAS module tables

## Architecture

All modules reference `thr_employees.id` as the single source of truth:
```
thr_employees (master) → All other tables reference employee_id
```

This ensures data integrity and enables cross-module reporting.