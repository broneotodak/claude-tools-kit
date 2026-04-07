-- Add epf_group column to master_hr2000 table
-- This stores the EPF group classification (E1, E6, etc.)
ALTER TABLE master_hr2000 
ADD COLUMN IF NOT EXISTS epf_group VARCHAR(10);