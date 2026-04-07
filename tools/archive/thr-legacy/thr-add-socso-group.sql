-- Add socso_group column to master_hr2000 table
-- Using TEXT instead of JSONB for simple group codes
ALTER TABLE master_hr2000 
ADD COLUMN IF NOT EXISTS socso_group TEXT;