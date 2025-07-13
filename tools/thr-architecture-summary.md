# THR System Architecture

## Core Principle: thr_employees as Master Data Source

All modules reference `thr_employees.id` as the single source of truth for employee data.

## Module Architecture

```
                    ┌─────────────────┐
                    │  thr_employees  │ (Master Data)
                    │   - auth_user_id│
                    │   - employee_no │
                    │   - personal_info│
                    └────────┬────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                    │                    │
   ┌────▼─────┐        ┌────▼─────┐        ┌────▼─────┐
   │    HR    │        │ACCOUNTING│        │  ATLAS   │
   │  Module  │        │  Module  │        │  Module  │
   └──────────┘        └──────────┘        └──────────┘
        │                    │                    │
   ✅ Ready:           🚧 Needed:           🚧 Needed:
   - employment_history - claims            - assets
   - leave_records     - claim_items        - asset_categories
   - payroll_records   - payment_batches    - asset_assignments
   - allowances        - tax_tables         - asset_maintenance
   - deductions        - gl_mappings        - depreciation
```

## Integration Points

### 1. **Employee Reference** (All modules → thr_employees)
- Every module table has `employee_id UUID REFERENCES thr_employees(id)`
- Ensures data integrity and single source of truth

### 2. **Organization Hierarchy** (Shared across modules)
```
thr_brands → thr_organizations → thr_departments → thr_sections
     ↓              ↓                   ↓               ↓
   Assets      Cost Centers        Approvals      Reporting
```

### 3. **Cross-Module Integration**
- **Payroll + Claims**: Monthly payroll includes approved claims
- **Assets + Claims**: Asset-related expense claims
- **Assets + HR**: Asset assignments affect allowances
- **Accounting + All**: Financial reporting across modules

## Data Flow Examples

### Example 1: Employee Onboarding
1. Create auth.users account (Google OAuth)
2. Create thr_employees record with auth_user_id
3. Add to thr_employment_history
4. Set up thr_employee_allowances
5. Assign assets via thr_asset_assignments

### Example 2: Monthly Payroll
1. Calculate from thr_payroll_records
2. Include thr_employee_allowances
3. Apply thr_employee_deductions
4. Add approved thr_claims
5. Generate thr_payment_batch

### Example 3: Asset Assignment
1. Create/select from thr_assets
2. Create thr_asset_assignments (employee_id)
3. Update employee allowances if needed
4. Track in thr_asset_maintenance

## Current Status

✅ **Phase 1 Complete**: Core HR structure ready
- Employee master data with auth support
- Basic payroll and compensation
- Leave management
- Organization hierarchy

🚧 **Phase 2**: Accounting Integration
- Claims and reimbursements
- Payment batch processing
- Tax calculations

🚧 **Phase 3**: ATLAS Integration
- Asset management
- Asset-employee relationships
- Depreciation tracking

## Key Design Decisions

1. **thr_employees is the hub** - All employee-related data references this table
2. **Modular design** - Each module has its own tables but integrates via IDs
3. **JSONB for flexibility** - Core data in columns, variable data in JSONB
4. **Auth integration** - One auth.users account per employee
5. **Multi-company ready** - Organization hierarchy supports multiple companies