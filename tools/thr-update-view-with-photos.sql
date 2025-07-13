-- Update the thr_employees_view to include photo fields

DROP VIEW IF EXISTS thr_employees_view CASCADE;

CREATE VIEW thr_employees_view AS
SELECT 
    e.id AS employee_id,
    e.employee_no,
    e.full_name,
    
    -- Photo fields (NEW)
    e.photo_url,
    e.thumbnail_url,
    
    -- Contact info
    e.contact_info->'emails'->>0 AS email,
    format_phone_for_whatsapp(
        e.contact_info->'phone'->>'mobile'
    ) AS phone_whatsapp,
    e.contact_info->'phone'->>'mobile' AS personal_mobile,
    e.contact_info->'phone'->>'work' AS work_phone,
    e.contact_info->'phone'->>'home' AS home_phone,
    
    -- Personal info
    e.ic_no,
    e.personal_info->>'birth_date' AS birth_date,
    e.personal_info->>'gender' AS gender,
    e.personal_info->>'marital_status' AS marital_status,
    e.personal_info->>'nationality' AS nationality,
    e.personal_info->>'religion' AS religion,
    e.personal_info->>'race' AS race,
    
    -- Employment info
    e.position_id,
    e.department_id,
    e.organization_id,
    e.employment_status,
    e.employment_info->>'hire_date' AS join_date,
    e.employment_info->>'resign_date' AS resign_date,
    e.employment_info->>'confirmation_date' AS confirmation_date,
    e.employment_info->>'last_promotion_date' AS last_promotion_date,
    
    -- Bank info
    e.bank_info->>'bank_name' AS bank_name,
    e.bank_info->>'account_no' AS account_no,
    e.bank_info->>'account_holder_name' AS account_holder_name,
    
    -- Tax info
    e.tax_info->>'epf_no' AS epf_no,
    e.tax_info->>'socso_no' AS socso_no,
    e.tax_info->>'tax_no' AS tax_no,
    e.tax_info->>'eis_no' AS eis_no,
    
    -- Compensation info
    e.compensation->>'basic_salary' AS basic_salary,
    e.compensation->'allowances'->>'housing' AS housing_allowance,
    e.compensation->'allowances'->>'transport' AS transport_allowance,
    e.compensation->'allowances'->>'meal' AS meal_allowance,
    e.compensation->'allowances'->>'phone' AS phone_allowance,
    e.compensation->'allowances'->>'other' AS other_allowances,
    
    -- Tax info (contains statutory deductions)
    e.tax_info->'epf'->>'employee' AS epf_employee,
    e.tax_info->'epf'->>'employer' AS epf_employer,
    e.tax_info->'socso'->>'employee' AS socso_employee,
    e.tax_info->'socso'->>'employer' AS socso_employer,
    e.tax_info->'eis'->>'employee' AS eis_employee,
    e.tax_info->'eis'->>'employer' AS eis_employer,
    e.tax_info->'income_tax'->>'pcb' AS pcb,
    
    -- Other deductions (if exists)
    e.compensation->'deductions'->>'loan' AS loan_deduction,
    e.compensation->'deductions'->>'advance' AS advance_deduction,
    e.compensation->'deductions'->>'other' AS other_deductions,
    
    -- Family info
    e.personal_info->'spouse_details'->>'name' AS spouse_name,
    e.personal_info->'spouse_details'->>'ic_no' AS spouse_ic,
    e.personal_info->'spouse_details'->>'occupation' AS spouse_occupation,
    e.personal_info->'spouse_details'->>'children_count' AS children_count,
    
    -- Emergency contact (if exists)
    e.contact_info->'emergency'->>'name' AS emergency_name,
    e.contact_info->'emergency'->>'relationship' AS emergency_relationship,
    e.contact_info->'emergency'->>'phone' AS emergency_phone,
    e.contact_info->'emergency'->>'address' AS emergency_address,
    
    -- Education (if exists)
    e.personal_info->'education'->>'highest_education' AS highest_education,
    e.personal_info->'education'->>'field_of_study' AS field_of_study,
    e.personal_info->'education'->>'institution' AS institution,
    e.personal_info->'education'->>'graduation_year' AS graduation_year,
    
    -- Metadata
    e.imported_at,
    e.created_at,
    e.updated_at,
    
    -- Related tables
    o.name AS organization_name,
    o.organization_code AS organization_code,
    d.department_name AS department_name,
    p.position_title AS position_title,
    
    -- Derived fields
    SPLIT_PART(e.contact_info->>'email', '@', 1) AS nickname,
    CASE 
        WHEN e.employment_status = 'active' THEN 'Active'
        WHEN e.employment_status = 'resigned' THEN 'Resigned'
        WHEN e.employment_status = 'terminated' THEN 'Terminated'
        ELSE 'Unknown'
    END AS status_display
FROM 
    thr_employees e
    LEFT JOIN thr_organizations o ON e.organization_id = o.organization_id
    LEFT JOIN thr_departments d ON e.department_id = d.id
    LEFT JOIN thr_positions p ON e.position_id = p.id
WHERE 
    e.active_status = true;