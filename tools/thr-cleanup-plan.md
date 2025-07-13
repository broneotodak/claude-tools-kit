# THR Database Cleanup Plan

## Current State Analysis
- Table: `master_hr2000` 
- Contains: All employee data from HR 2000 migration
- Mixed structured and unstructured data
- Many redundant columns
- Some data already in JSONB format

## Cleanup Strategy

### Phase 1: Data Consolidation into JSONB (Safe - No Data Loss)

#### 1.1 Contact Information
```sql
-- Consolidate into contact_info JSONB
contact_info: {
  "email": "email field",
  "mobile": "mobile field", 
  "home_phone": "home_phone field",
  "home_address": {
    "street": "address field",
    "postal": "postal_code field",
    "city": "city field",
    "state": "state field"
  }
}
```

#### 1.2 Bank Information
```sql
-- Consolidate into bank_info JSONB
bank_info: {
  "bank_code": "bank_code field",
  "bank_name": "bank_name field",
  "branch": "branch field",
  "account_no": "account_no field",
  "payment_type": "payment_type field",
  "payment_frequency": "payment_frequency field",
  "payment_via": "payment_via field"
}
```

#### 1.3 Employment Timeline
```sql
-- Consolidate into employment_timeline JSONB
employment_timeline: {
  "hire_date": "hire_date field",
  "confirm_date": "confirm_date field",
  "resign_date": "resign_date field",
  "retire_date": "retire_date field",
  "increment_date": "increment_date field",
  "last_working_date": "calculated field"
}
```

#### 1.4 Tax & Statutory Information
```sql
-- Consolidate into tax_info JSONB
tax_info: {
  "lhdn_no": "lhdn_no field",
  "income_tax_branch": "income_tax_branch field",
  "pcb_group": "pcb field",
  "ea_form": "ea_form field",
  "epf_no": "epf_no field",
  "epf_group": "epf_group field",
  "socso_no": "perkeso_code field",
  "socso_group": "socso_group field",
  "eis_group": "eis_group field"
}
```

#### 1.5 Compensation Details
```sql
-- Consolidate into compensation JSONB
compensation: {
  "current_basic": "basic_salary field",
  "mid_basic": "mid_basic field",
  "previous_basic": "previous_basic field",
  "allowances": "allowances field",
  "fixed_allowances": "fixed_allowances field",
  "deductions": "extracted from fixed_allowances"
}
```

#### 1.6 Personal Identification
```sql
-- Consolidate into identification JSONB
identification: {
  "ic_new": "ic_new field",
  "ic_old": "ic_old field",
  "passport_no": "passport_no field",
  "immigration_no": "immigration_no field",
  "immigration_expiry": "immigration_expiry field"
}
```

### Phase 2: Create Normalized Tables (For Brand → Organization → Employee)

#### 2.1 Brands Table
```sql
CREATE TABLE brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  code VARCHAR(10) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 2.2 Organizations Table
```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID REFERENCES brands(id),
  name VARCHAR(100) NOT NULL,
  code VARCHAR(10) UNIQUE NOT NULL,
  type VARCHAR(50), -- subsidiary, division, department
  parent_org_id UUID REFERENCES organizations(id),
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 2.3 Enhanced Employees Table
```sql
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_no VARCHAR(20) UNIQUE NOT NULL,
  organization_id UUID REFERENCES organizations(id),
  
  -- Core fields
  full_name VARCHAR(200) NOT NULL,
  preferred_name VARCHAR(100),
  
  -- JSONB consolidated fields
  identification JSONB,
  contact_info JSONB,
  demographics JSONB,
  employment_timeline JSONB,
  compensation JSONB,
  tax_info JSONB,
  bank_info JSONB,
  statutory_deductions JSONB,
  spouse_details JSONB,
  
  -- Status fields
  employment_status VARCHAR(20) DEFAULT 'active',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Phase 3: Safe Migration Process

1. **Create backup first**
2. **Add new JSONB columns to existing table**
3. **Migrate data to JSONB columns (keep originals)**
4. **Verify all data migrated correctly**
5. **Create new normalized tables**
6. **Migrate to new structure**
7. **Only then remove old columns**

### Phase 4: Columns to Remove (After Verification)

- Individual address fields (after consolidating to contact_info)
- Individual bank fields (after consolidating to bank_info)
- Individual date fields (after consolidating to employment_timeline)
- Individual tax fields (after consolidating to tax_info)
- Redundant status fields
- Empty/unused fields

## Benefits of This Approach

1. **No data loss** - Everything preserved in JSONB
2. **Better organization** - Related data grouped together
3. **Flexible schema** - JSONB allows future additions
4. **Improved performance** - Fewer columns, better indexing
5. **Supports hierarchy** - Brand → Organization → Employee
6. **API-ready** - JSONB works well with modern APIs
7. **Audit trail** - Original data preserved during migration

## Next Steps

1. Review and approve the plan
2. Create backup of current data
3. Start with Phase 1 consolidation scripts
4. Test each consolidation thoroughly
5. Proceed to normalization only after Phase 1 success