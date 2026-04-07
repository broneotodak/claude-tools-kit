-- SQL to add resign_date column to master_hr2000 table
-- This is needed to track employee resignation/termination dates

-- Add the resign_date column
ALTER TABLE master_hr2000 
ADD COLUMN IF NOT EXISTS resign_date DATE;

-- Create an index for better query performance
CREATE INDEX IF NOT EXISTS idx_resign_date ON master_hr2000(resign_date);

-- Update active_status based on resign_date (if you want to automate this)
-- UPDATE master_hr2000 
-- SET active_status = false 
-- WHERE resign_date IS NOT NULL AND resign_date <= CURRENT_DATE;

-- Query to verify the column was added
-- SELECT column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name = 'master_hr2000' 
-- AND column_name = 'resign_date';