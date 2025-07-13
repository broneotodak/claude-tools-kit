#!/bin/bash
# Restore script for THR database
# Created: 2025-07-12T17:21:36.991Z

echo "⚠️  WARNING: This will restore master_hr2000 from backup master_hr2000_backup_2025_07_12"
echo "All current data in master_hr2000 will be replaced!"
read -p "Are you sure? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Restore cancelled."
    exit 1
fi

# SQL to restore from backup
# Set these environment variables before running:
# export DATABASE_URL="your_database_connection_string"
psql "$DATABASE_URL" -c "
-- Create temporary table with current structure
CREATE TABLE master_hr2000_temp AS SELECT * FROM master_hr2000 LIMIT 0;

-- Drop current table
DROP TABLE master_hr2000;

-- Recreate from backup
CREATE TABLE master_hr2000 AS SELECT * FROM master_hr2000_backup_2025_07_12;

-- Restore any missing constraints, indexes, etc.
-- Add them here based on your schema
"

echo "✅ Restore complete!"
