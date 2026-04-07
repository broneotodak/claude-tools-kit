-- Add epf_no column to master_hr2000 table
-- This stores the employee's EPF account number
ALTER TABLE master_hr2000 
ADD COLUMN IF NOT EXISTS epf_no VARCHAR(20);