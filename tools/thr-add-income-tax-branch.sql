-- Add income_tax_branch column to master_hr2000 table
-- This stores the LHDN branch code (e.g., SEL, IBU PE)
ALTER TABLE master_hr2000 
ADD COLUMN IF NOT EXISTS income_tax_branch VARCHAR(50);