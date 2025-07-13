-- SQL functions for THR database

-- Function to find employees in multiple organizations
CREATE OR REPLACE FUNCTION find_duplicate_employees()
RETURNS TABLE (
  ic_no TEXT,
  employee_count BIGINT,
  organizations TEXT[],
  names TEXT[]
) 
LANGUAGE sql
AS $$
  SELECT 
    ic_no,
    COUNT(*) as employee_count,
    ARRAY_AGG(DISTINCT organization_code ORDER BY organization_code) as organizations,
    ARRAY_AGG(DISTINCT name ORDER BY name) as names
  FROM master_hr2000
  WHERE ic_no IS NOT NULL
  GROUP BY ic_no
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC, ic_no;
$$;