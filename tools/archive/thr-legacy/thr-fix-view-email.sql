-- Fix the email extraction in the view

DROP VIEW IF EXISTS thr_employees_view CASCADE;

CREATE VIEW thr_employees_view AS
SELECT 
    e.id AS employee_id,
    e.employee_no,
    e.full_name,
    e.ic_no,
    
    -- Photo fields (IMPORTANT - this is what we need)
    e.photo_url,
    e.thumbnail_url,
    
    -- Direct columns we confirmed exist
    e.active_status,
    e.employment_status,
    e.position_id,
    e.department_id,
    e.organization_id,
    e.section_id,
    e.access_level,
    
    -- Contact info (FIXED - emails is an object, not array)
    COALESCE(
        e.contact_info->'emails'->>'company',
        e.contact_info->'emails'->>'personal',
        e.contact_info->'emails'->>0
    ) AS email,
    format_phone_for_whatsapp(
        e.contact_info->'phone'->>'mobile'
    ) AS phone_whatsapp,
    e.contact_info->'phone'->>'mobile' AS personal_mobile,
    
    -- Basic employment info
    e.employment_info->>'hire_date' AS join_date,
    e.employment_info->>'designation' AS designation,
    e.employment_info->>'grade' AS grade,
    
    -- Basic personal info
    e.personal_info->>'gender' AS gender,
    e.personal_info->>'marital_status' AS marital_status,
    
    -- Basic compensation
    e.compensation->>'basic_salary' AS basic_salary,
    
    -- Related tables
    o.name AS organization_name,
    o.organization_code AS organization_code,
    d.department_name AS department_name,
    p.position_title AS position_title,
    
    -- Timestamps
    e.created_at,
    e.updated_at,
    
    -- Derived fields
    SPLIT_PART(
        COALESCE(
            e.contact_info->'emails'->>'company',
            e.contact_info->'emails'->>'personal',
            ''
        ), 
        '@', 
        1
    ) AS nickname
FROM 
    thr_employees e
    LEFT JOIN thr_organizations o ON e.organization_id = o.organization_id
    LEFT JOIN thr_departments d ON e.department_id = d.id
    LEFT JOIN thr_positions p ON e.position_id = p.id
WHERE 
    e.active_status = true;