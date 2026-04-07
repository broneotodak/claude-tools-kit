-- Add reporting structure to thr_employees table

-- Add reporting_to column
ALTER TABLE thr_employees 
ADD COLUMN IF NOT EXISTS reporting_to UUID REFERENCES thr_employees(id);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_thr_employees_reporting_to ON thr_employees(reporting_to);
CREATE INDEX IF NOT EXISTS idx_thr_employees_employment_status ON thr_employees(employment_status);

-- Add comment for clarity
COMMENT ON COLUMN thr_employees.reporting_to IS 'UUID of the employee this person reports to (their direct manager)';

-- Sample update to show reporting structure
-- This makes some employees report to Neo Todak (CEO)
UPDATE thr_employees 
SET reporting_to = 'f221e445-ac90-4417-852b-ab76d792bd0c'
WHERE organization_id = (
    SELECT id FROM thr_organizations WHERE name = 'Todak Studios Sdn. Bhd.'
)
AND employee_no != 'TS001'  -- Don't make CEO report to himself
AND employment_status = 'active'
LIMIT 5;  -- Just 5 for testing