# THR Database Schema Analysis

## Current Structure Overview

### Table: master_hr2000
- **Total Columns**: 73
- **Primary Key**: id (UUID)
- **Foreign Key**: organization_id → thr_organizations
- **RLS Status**: DISABLED (rowsecurity: false)
- **Unique Constraint**: (organization_id, employee_no)

### Column Categories

#### 1. Already JSONB (5 columns)
- `bank_branch` - Should be part of bank_info
- `fixed_allowances` - Complex allowances structure
- `allowances` - Simplified allowances array
- `deductions` - Deductions array
- `statutory_deductions` - Tax deductions (currently empty)
- `spouse_details` - Spouse information

#### 2. Core Identity Fields (Keep as-is)
- `id` (UUID, PK)
- `employee_no` (text, indexed)
- `employee_name` (text, indexed)
- `organization_id` (UUID, FK)

#### 3. Candidates for Contact Info JSONB
- `mobile`
- `personal_email`
- `company_email`
- `address` (empty)
- `address2` (empty)
- `city` (empty)
- `state` (empty)
- `postcode` (empty)
- `country` (empty)

#### 4. Candidates for Bank Info JSONB
- `bank_name`
- `bank_acc_no`
- `bank_branch` (already JSONB)

#### 5. Candidates for Employment Timeline JSONB
- `employment_date`
- `confirmation_date`
- `resign_date`

#### 6. Candidates for Tax Info JSONB
- `lhdn_no`
- `income_tax_branch`
- `pcb` (numeric)
- `ea_form`
- `epf_no`
- `epf_group`
- `socso_no` / `perkeso_code` (duplicate)
- `socso_group`
- `eis_group`

#### 7. Candidates for Demographics JSONB
- `ic_no`
- `date_of_birth`
- `birth_place` (empty)
- `race`
- `religion`
- `marital_status`
- `gender`
- `nationality`
- `citizen`
- `pr_status` (empty)

#### 8. Candidates for Compensation JSONB
- `basic_salary`
- `total_allowance`
- `total_deduction`
- `net_salary`
- `kwsp_employer`
- `kwsp_employee`
- `eis_employer`
- `eis_employee`
- `socso_employer`
- `socso_employee`

#### 9. Spouse Fields (Already consolidated)
- `spouse_name`
- `spouse_ic`
- `spouse_occupation`
- `spouse_employer`
- `spouse_employment_date`
- `spouse_dob`

#### 10. Organizational Fields
- `branch` (empty)
- `department`
- `section`
- `designation`
- `reporting_to` (empty)
- `grade`
- `staff_category`

#### 11. System Fields
- `active_status`
- `data_source`
- `created_at`
- `updated_at`

## Cleanup Priority

### Phase 1: Remove Empty Columns (10 columns)
These columns have no data across all records:
- `address`, `address2`, `city`, `state`, `postcode`, `country`
- `birth_place`
- `pr_status`
- `branch`
- `reporting_to`

### Phase 2: Consolidate to JSONB
1. **contact_info**: Combine emails, mobile, address fields
2. **bank_info**: Combine bank fields
3. **employment_info**: Dates and organizational data
4. **tax_statutory**: All tax and statutory fields
5. **demographics**: Personal information fields
6. **compensation**: All salary and deduction fields

### Phase 3: Fix Duplicates
- `socso_no` vs `perkeso_code` (same data)
- `spouse_*` fields vs `spouse_details` JSONB

### Benefits
- Reduce from 73 to ~20 columns
- Better organization
- Easier querying with JSONB
- Maintains all data integrity