-- Create function to get organization statistics
CREATE OR REPLACE FUNCTION get_organization_stats()
RETURNS TABLE(
    organization_id UUID,
    organization_name VARCHAR,
    employee_count BIGINT,
    active_count BIGINT,
    resigned_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.id AS organization_id,
        o.name AS organization_name,
        COUNT(e.id) AS employee_count,
        COUNT(CASE WHEN e.employment_status = 'active' THEN 1 END) AS active_count,
        COUNT(CASE WHEN e.employment_status = 'resigned' THEN 1 END) AS resigned_count
    FROM thr_organizations o
    LEFT JOIN thr_employees e ON e.organization_id = o.id
    GROUP BY o.id, o.name
    ORDER BY employee_count DESC;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to anon role
GRANT EXECUTE ON FUNCTION get_organization_stats() TO anon;
GRANT EXECUTE ON FUNCTION get_organization_stats() TO authenticated;