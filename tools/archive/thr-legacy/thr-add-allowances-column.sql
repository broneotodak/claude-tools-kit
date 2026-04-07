-- Add allowances column to master_hr2000 table
-- This will store all allowance details as JSONB array

ALTER TABLE master_hr2000 
ADD COLUMN IF NOT EXISTS allowances JSONB;

-- The JSONB structure will be an array of allowance objects:
-- [
--   {
--     "code": "PHONE",
--     "description": "PHONE ALLOWANCE",
--     "amount": 70.00,
--     "period": "END",
--     "start_date": "01/2024",
--     "end_date": "12/2024"
--   },
--   {
--     "code": "COVERING",
--     "description": "COVERING ALLOWANCE", 
--     "amount": 500.00,
--     "period": "END",
--     "start_date": "02/2023",
--     "end_date": "06/2023"
--   }
-- ]

-- Add comment to document the column
COMMENT ON COLUMN master_hr2000.allowances IS 'Individual allowances with details - array of objects containing code, description, amount, period, start_date, end_date';