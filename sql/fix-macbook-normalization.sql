-- Fix MacBook-Pro-3.local to be normalized as MacBook Pro

-- First update the normalization function
CREATE OR REPLACE FUNCTION normalize_machine_name(machine_name TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Handle null or empty
    IF machine_name IS NULL OR machine_name = '' THEN
        RETURN 'Unknown Machine';
    END IF;
    
    -- Normalize Windows/PC variations for your home setup
    IF machine_name IN ('NEO-MOTHERSHIP', 'Home PC', 'Windows PC', 'DESKTOP-NEO') OR
       machine_name ILIKE '%home%pc%' THEN
        RETURN 'Windows Home PC';
    END IF;
    
    -- Office PC normalization
    IF machine_name ILIKE '%office%pc%' OR machine_name = 'OFFICE-DESKTOP' THEN
        RETURN 'Office PC';
    END IF;
    
    -- Mac variations - normalize all MacBook variations to "MacBook Pro"
    IF machine_name ILIKE 'macbook%' OR machine_name = 'mac' THEN
        RETURN 'MacBook Pro';
    END IF;
    
    -- Default: return as-is
    RETURN machine_name;
END;
$$ LANGUAGE plpgsql;

-- Update existing MacBook-Pro-3.local entries
UPDATE activity_log
SET metadata = jsonb_set(
    metadata,
    '{machine}',
    '"MacBook Pro"'
)
WHERE metadata->>'machine' = 'MacBook-Pro-3.local';

-- Show updated machine counts
SELECT 
    metadata->>'machine' as machine_name,
    COUNT(*) as count
FROM activity_log
WHERE metadata->>'machine' IS NOT NULL
GROUP BY metadata->>'machine'
ORDER BY count DESC;