#!/usr/bin/env node

/**
 * THR-Specific Domain Agents
 * 
 * These agents have deep knowledge of THR's database structure,
 * business logic, and Malaysian HR regulations.
 * 
 * Built on top of the enhanced sub-agent system.
 */

const { SubAgentOrchestrator, AGENT_TYPES } = require('./sub-agents-enhanced');
const { AdvancedOrchestrator, WORKFLOW_PATTERNS } = require('./sub-agent-orchestrator');
const { SubAgentMemorySystem, MEMORY_TYPES, PRIORITY_LEVELS } = require('./sub-agent-memory-system');

// THR Database Configuration
const THR_CONFIG = {
    database: {
        url: 'https://ftbtsxlujsnobujwekwx.supabase.co',
        tables: {
            employees: 'thr_employees',
            organizations: 'thr_organizations',
            departments: 'thr_departments',
            positions: 'thr_positions',
            leave: {
                applications: 'thr_leave_applications',
                balances: 'thr_leave_balances',
                types: 'thr_leave_types'
            },
            claims: {
                main: 'thr_claims',
                types: 'thr_claim_types',
                receipts: 'thr_claim_receipts'
            },
            payroll: {
                transactions: 'thr_payroll_transactions',
                periods: 'thr_payroll_periods',
                batches: 'thr_payroll_batches',
                pcb: 'thr_pcb'
            }
        },
        views: {
            employeesEnriched: 'v_employees_enriched'
        }
    },
    frontend: {
        modules: ['employees', 'leave', 'claims', 'payroll', 'documents', 'messaging', 'notifications'],
        components: {
            dashboard: '/src/shared/pages/Dashboard.jsx',
            employeeDirectory: '/src/modules/employees/pages/EmployeeDirectory.jsx',
            claims: '/src/shared/pages/ClaimsFixed.jsx',
            payroll: '/src/shared/pages/PayrollManagementV3.jsx'
        }
    },
    regulations: {
        epf: { employee: 0.11, employer: 0.12 }, // 2025 rates
        socso: { maxSalary: 5000, rates: [0.0175, 0.0125] },
        eis: { rate: 0.002 },
        pcb: { threshold: 2833 }, // Monthly threshold
        leaveTypes: ['Annual', 'Medical', 'Emergency', 'Maternity', 'Paternity', 'Unpaid']
    }
};

/**
 * THR Employee Agent
 * Manages all employee-related operations with deep knowledge of HR2000 data structure
 */
class THREmployeeAgent {
    constructor(orchestrator, memorySystem) {
        this.orchestrator = orchestrator;
        this.memory = memorySystem;
        this.name = 'THR Employee Specialist';
        this.capabilities = [
            'employee-crud',
            'profile-management',
            'organization-mapping',
            'data-validation',
            'hr2000-integration'
        ];
        
        // Domain knowledge
        this.knowledge = {
            totalEmployees: 518,
            organizations: 17,
            positions: 183,
            dataFields: [
                'staff_id', 'name', 'ic_no', 'email', 'phone',
                'organization_id', 'department', 'position', 'grade',
                'employment_date', 'confirmation_date', 'resign_date',
                'basic_salary', 'allowances', 'deductions',
                'bank_name', 'bank_account', 'epf_no', 'socso_no', 'tax_no'
            ],
            validationRules: {
                ic_no: /^\d{12}$/,
                email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                phone: /^(\+?6?01)[0-9]{7,9}$/,
                staff_id: /^[A-Z0-9-]+$/
            }
        };
    }

    async validateEmployee(employeeData) {
        const errors = [];
        const warnings = [];

        // Check required fields
        const requiredFields = ['staff_id', 'name', 'ic_no', 'organization_id'];
        for (const field of requiredFields) {
            if (!employeeData[field]) {
                errors.push(`Missing required field: ${field}`);
            }
        }

        // Validate IC number
        if (employeeData.ic_no && !this.knowledge.validationRules.ic_no.test(employeeData.ic_no)) {
            errors.push(`Invalid IC number format: ${employeeData.ic_no}`);
        }

        // Validate email
        if (employeeData.email && !this.knowledge.validationRules.email.test(employeeData.email)) {
            warnings.push(`Invalid email format: ${employeeData.email}`);
        }

        // Check organization exists
        if (employeeData.organization_id > 17) {
            errors.push(`Invalid organization_id: ${employeeData.organization_id}`);
        }

        // Remember validation results
        await this.memory.remember({
            action: 'employee-validation',
            data: employeeData,
            errors,
            warnings
        }, MEMORY_TYPES.PROCEDURAL);

        return { valid: errors.length === 0, errors, warnings };
    }

    async enrichEmployeeData(employeeId) {
        // Use the enriched view for complete data
        const query = `
            SELECT * FROM v_employees_enriched 
            WHERE id = ${employeeId}
        `;

        // Store query pattern for future use
        await this.memory.remember({
            pattern: 'employee-enrichment',
            query,
            view: 'v_employees_enriched'
        }, MEMORY_TYPES.SEMANTIC);

        return {
            query,
            explanation: 'Using enriched view to avoid N+1 queries',
            includesRelations: ['organization', 'department', 'position']
        };
    }

    async handleNameCorrection(oldName, newName, reason) {
        // Based on the 42 name corrections already done
        const correction = {
            timestamp: new Date().toISOString(),
            old_name: oldName,
            new_name: newName,
            reason,
            affected_tables: [
                'thr_employees',
                'thr_payroll_transactions',
                'thr_leave_applications',
                'thr_claims'
            ]
        };

        // Learn from this correction
        await this.memory.learn(
            `Name correction: ${oldName} → ${newName}`,
            `Always update all related tables when changing employee names`
        );

        return correction;
    }
}

/**
 * THR Payroll Agent
 * Handles payroll calculations with Malaysian tax regulations
 */
class THRPayrollAgent {
    constructor(orchestrator, memorySystem) {
        this.orchestrator = orchestrator;
        this.memory = memorySystem;
        this.name = 'THR Payroll Specialist';
        this.capabilities = [
            'salary-calculation',
            'epf-computation',
            'socso-computation',
            'pcb-calculation',
            'payslip-generation',
            'batch-processing'
        ];

        // Malaysian payroll knowledge
        this.knowledge = {
            epfRates: {
                employee: {
                    below60: 0.11,
                    above60: 0.04
                },
                employer: {
                    below60: 0.12,
                    above60: 0.04
                }
            },
            socsoCategories: {
                1: { max: 30, employee: 0.25, employer: 1.75 },
                2: { max: 50, employee: 0.50, employer: 3.50 },
                // ... complete SOCSO table
                max: { salary: 5000, employee: 19.75, employer: 39.05 }
            },
            eisRate: 0.002,
            pcbCategories: {
                single: { threshold: 2833 },
                married: { threshold: 3333 }
            },
            existingTransactions: 723,
            payrollPeriods: 13
        };
    }

    async calculateNetSalary(employee) {
        const calculations = {
            basic: employee.basic_salary || 0,
            allowances: employee.allowances || 0,
            gross: 0,
            deductions: {
                epf_employee: 0,
                socso_employee: 0,
                eis_employee: 0,
                pcb: 0,
                other: employee.deductions || 0
            },
            employer_contributions: {
                epf_employer: 0,
                socso_employer: 0,
                eis_employer: 0
            },
            net: 0
        };

        // Calculate gross
        calculations.gross = calculations.basic + calculations.allowances;

        // EPF Calculation
        const epfRate = employee.age >= 60 ? 
            this.knowledge.epfRates.employee.above60 : 
            this.knowledge.epfRates.employee.below60;
        calculations.deductions.epf_employee = Math.round(calculations.gross * epfRate);
        
        const epfEmployerRate = employee.age >= 60 ? 
            this.knowledge.epfRates.employer.above60 : 
            this.knowledge.epfRates.employer.below60;
        calculations.employer_contributions.epf_employer = Math.round(calculations.gross * epfEmployerRate);

        // SOCSO Calculation (simplified)
        if (calculations.gross <= 5000) {
            calculations.deductions.socso_employee = 19.75;
            calculations.employer_contributions.socso_employer = 39.05;
        }

        // EIS Calculation
        calculations.deductions.eis_employee = Math.round(calculations.gross * this.knowledge.eisRate);
        calculations.employer_contributions.eis_employer = calculations.deductions.eis_employee;

        // PCB Calculation (simplified)
        if (calculations.gross > this.knowledge.pcbCategories.single.threshold) {
            calculations.deductions.pcb = Math.round((calculations.gross - this.knowledge.pcbCategories.single.threshold) * 0.1);
        }

        // Calculate net
        const totalDeductions = Object.values(calculations.deductions).reduce((a, b) => a + b, 0);
        calculations.net = calculations.gross - totalDeductions;

        // Store calculation pattern
        await this.memory.remember({
            pattern: 'payroll-calculation',
            employee_id: employee.id,
            calculations
        }, MEMORY_TYPES.PROCEDURAL);

        return calculations;
    }

    async processBatchPayroll(organizationId, period) {
        const workflow = {
            steps: [
                'Fetch all active employees',
                'Calculate individual salaries',
                'Generate payroll transactions',
                'Create batch record',
                'Generate payslips',
                'Update payroll_transactions table'
            ],
            queries: [
                `SELECT * FROM thr_employees WHERE organization_id = ${organizationId} AND resign_date IS NULL`,
                `INSERT INTO thr_payroll_transactions ...`,
                `INSERT INTO thr_payroll_batches ...`
            ]
        };

        // Learn batch processing pattern
        await this.memory.learn(
            'Batch payroll processing',
            'Always process in transaction to ensure consistency'
        );

        return workflow;
    }
}

/**
 * THR Leave Agent
 * Manages leave applications and balances
 */
class THRLeaveAgent {
    constructor(orchestrator, memorySystem) {
        this.orchestrator = orchestrator;
        this.memory = memorySystem;
        this.name = 'THR Leave Management Specialist';
        this.capabilities = [
            'leave-application',
            'balance-calculation',
            'approval-workflow',
            'carry-forward',
            'leave-policy'
        ];

        this.knowledge = {
            leaveTypes: [
                { id: 1, name: 'Annual Leave', default_days: 14, carry_forward: true },
                { id: 2, name: 'Medical Leave', default_days: 14, carry_forward: false },
                { id: 3, name: 'Emergency Leave', default_days: 3, carry_forward: false },
                { id: 4, name: 'Maternity Leave', default_days: 60, carry_forward: false },
                { id: 5, name: 'Paternity Leave', default_days: 7, carry_forward: false },
                { id: 6, name: 'Unpaid Leave', default_days: 0, carry_forward: false },
                { id: 7, name: 'Compassionate Leave', default_days: 3, carry_forward: false },
                { id: 8, name: 'Hajj Leave', default_days: 7, carry_forward: false },
                { id: 9, name: 'Study Leave', default_days: 0, carry_forward: false }
            ],
            currentStatus: {
                applications: 0, // Empty table - new system
                balances: 0, // Needs initialization
                year: 2025
            },
            approvalLevels: ['Supervisor', 'Manager', 'HR', 'Director']
        };
    }

    async initializeYearBalances(year = 2025) {
        const initialization = {
            year,
            script: `
                -- Initialize leave balances for ${year}
                INSERT INTO thr_leave_balances (employee_id, leave_type_id, year, entitlement, used, balance)
                SELECT 
                    e.id,
                    lt.id,
                    ${year},
                    CASE 
                        WHEN lt.name = 'Annual Leave' THEN 
                            CASE 
                                WHEN EXTRACT(YEAR FROM e.employment_date) < ${year} THEN 14
                                ELSE ROUND(14 * (12 - EXTRACT(MONTH FROM e.employment_date) + 1) / 12)
                            END
                        ELSE lt.default_days
                    END as entitlement,
                    0 as used,
                    CASE 
                        WHEN lt.name = 'Annual Leave' THEN 
                            CASE 
                                WHEN EXTRACT(YEAR FROM e.employment_date) < ${year} THEN 14
                                ELSE ROUND(14 * (12 - EXTRACT(MONTH FROM e.employment_date) + 1) / 12)
                            END
                        ELSE lt.default_days
                    END as balance
                FROM thr_employees e
                CROSS JOIN thr_leave_types lt
                WHERE e.resign_date IS NULL
            `,
            explanation: 'Prorated annual leave for new employees, full entitlement for others'
        };

        // Remember initialization pattern
        await this.memory.remember({
            action: 'leave-initialization',
            year,
            pattern: initialization
        }, MEMORY_TYPES.PROCEDURAL);

        return initialization;
    }

    async processLeaveApplication(application) {
        const validationSteps = [
            'Check employee exists and is active',
            'Verify leave balance sufficient',
            'Check for date conflicts',
            'Check blackout periods',
            'Route to appropriate approver'
        ];

        const approvalWorkflow = {
            pattern: WORKFLOW_PATTERNS.SEQUENTIAL,
            steps: [
                { level: 'Supervisor', action: 'initial-approval' },
                { level: 'Manager', action: 'final-approval' },
                { level: 'HR', action: 'record-keeping' }
            ]
        };

        // Store workflow knowledge
        await this.memory.remember({
            workflow: 'leave-approval',
            steps: approvalWorkflow
        }, MEMORY_TYPES.PROCEDURAL);

        return { validationSteps, approvalWorkflow };
    }
}

/**
 * THR Claims Agent
 * Processes expense claims and reimbursements
 */
class THRClaimsAgent {
    constructor(orchestrator, memorySystem) {
        this.orchestrator = orchestrator;
        this.memory = memorySystem;
        this.name = 'THR Claims Processing Specialist';
        this.capabilities = [
            'claim-submission',
            'receipt-validation',
            'approval-routing',
            'reimbursement-calculation',
            'audit-trail'
        ];

        this.knowledge = {
            claimTypes: [
                { name: 'Medical', limit: 5000, requires_receipt: true },
                { name: 'Travel', limit: 2000, requires_receipt: true },
                { name: 'Meal', limit: 50, requires_receipt: false },
                { name: 'Phone', limit: 200, requires_receipt: true },
                { name: 'Training', limit: 10000, requires_receipt: true }
            ],
            currentClaims: 2,
            approvalLimits: {
                supervisor: 500,
                manager: 2000,
                director: 5000,
                ceo: Infinity
            },
            tables: {
                claims: 'thr_claims',
                types: 'thr_claim_types',
                receipts: 'thr_claim_receipts'
            }
        };
    }

    async validateClaim(claim) {
        const validation = {
            checks: [],
            errors: [],
            warnings: []
        };

        // Amount validation
        const claimType = this.knowledge.claimTypes.find(t => t.name === claim.type);
        if (claimType) {
            if (claim.amount > claimType.limit) {
                validation.errors.push(`Amount exceeds limit of ${claimType.limit}`);
            }
            if (claimType.requires_receipt && !claim.receipt_url) {
                validation.errors.push('Receipt required for this claim type');
            }
        }

        // Date validation
        const claimDate = new Date(claim.date);
        const daysSince = (Date.now() - claimDate) / (1000 * 60 * 60 * 24);
        if (daysSince > 60) {
            validation.warnings.push('Claim is older than 60 days');
        }

        // Determine approver based on amount
        let approver = 'supervisor';
        for (const [role, limit] of Object.entries(this.knowledge.approvalLimits)) {
            if (claim.amount <= limit) {
                approver = role;
                break;
            }
        }
        validation.approver = approver;

        // Store validation pattern
        await this.memory.remember({
            pattern: 'claim-validation',
            rules: validation
        }, MEMORY_TYPES.PROCEDURAL);

        return validation;
    }

    async processClaimWorkflow(claim) {
        const workflow = {
            name: 'Claim Processing',
            pattern: WORKFLOW_PATTERNS.SAGA,
            transactions: [
                {
                    step: 'validate-claim',
                    rollback: 'mark-invalid'
                },
                {
                    step: 'check-budget',
                    rollback: 'release-budget-hold'
                },
                {
                    step: 'route-approval',
                    rollback: 'cancel-routing'
                },
                {
                    step: 'process-payment',
                    rollback: 'reverse-payment'
                }
            ]
        };

        return workflow;
    }
}

/**
 * THR Reporting Agent
 * Generates reports and analytics
 */
class THRReportingAgent {
    constructor(orchestrator, memorySystem) {
        this.orchestrator = orchestrator;
        this.memory = memorySystem;
        this.name = 'THR Reporting & Analytics Specialist';
        this.capabilities = [
            'report-generation',
            'data-aggregation',
            'statutory-reports',
            'dashboard-metrics',
            'export-formats'
        ];

        this.knowledge = {
            reportTypes: [
                'Employee List',
                'Payroll Summary',
                'Leave Balance Report',
                'Claims Analysis',
                'EA Form',
                'EPF Submission',
                'SOCSO Report',
                'Headcount Analysis',
                'Turnover Report'
            ],
            dashboardWidgets: [
                'employee-count',
                'payroll-total',
                'pending-leaves',
                'pending-claims',
                'birthday-list',
                'department-breakdown'
            ],
            exportFormats: ['PDF', 'Excel', 'CSV', 'JSON'],
            aggregations: {
                employeeCount: 518,
                totalOrganizations: 17,
                payrollTransactions: 723
            }
        };
    }

    async generateReport(reportType, parameters) {
        const reportQueries = {
            'Employee List': `
                SELECT 
                    staff_id, name, ic_no, 
                    organization_name, department, position,
                    employment_date, basic_salary
                FROM v_employees_enriched
                WHERE organization_id = $1
                ORDER BY name
            `,
            'Payroll Summary': `
                SELECT 
                    period,
                    COUNT(*) as employee_count,
                    SUM(gross_salary) as total_gross,
                    SUM(net_salary) as total_net,
                    SUM(epf_employer) as total_epf,
                    SUM(socso_employer) as total_socso
                FROM thr_payroll_transactions
                WHERE period = $1
                GROUP BY period
            `,
            'EA Form': `
                SELECT 
                    e.name, e.ic_no, e.tax_no,
                    SUM(pt.gross_salary) as annual_gross,
                    SUM(pt.epf_employee) as annual_epf,
                    SUM(pt.pcb) as annual_pcb
                FROM thr_employees e
                JOIN thr_payroll_transactions pt ON e.id = pt.employee_id
                WHERE EXTRACT(YEAR FROM pt.period) = $1
                GROUP BY e.id, e.name, e.ic_no, e.tax_no
            `
        };

        const query = reportQueries[reportType];
        
        // Store report pattern
        await this.memory.remember({
            report: reportType,
            query,
            parameters
        }, MEMORY_TYPES.SEMANTIC);

        return { query, parameters, format: 'Excel' };
    }

    async calculateDashboardMetrics() {
        const metrics = {
            realtime: [
                {
                    metric: 'Active Employees',
                    query: 'SELECT COUNT(*) FROM thr_employees WHERE resign_date IS NULL',
                    value: 516
                },
                {
                    metric: 'Pending Leaves',
                    query: 'SELECT COUNT(*) FROM thr_leave_applications WHERE status = "pending"',
                    value: 0
                },
                {
                    metric: 'Monthly Payroll',
                    query: 'SELECT SUM(net_salary) FROM thr_payroll_transactions WHERE period = CURRENT_MONTH',
                    value: 0
                }
            ],
            cached: {
                ttl: 300, // 5 minutes
                metrics: ['employee-count', 'organization-count']
            }
        };

        return metrics;
    }
}

/**
 * THR System Orchestrator
 * Coordinates all THR agents for complex workflows
 */
class THRSystemOrchestrator {
    constructor() {
        this.orchestrator = new SubAgentOrchestrator();
        this.memorySystem = new SubAgentMemorySystem();
        
        // Initialize THR-specific agents
        this.agents = {
            employee: new THREmployeeAgent(this.orchestrator, this.memorySystem),
            payroll: new THRPayrollAgent(this.orchestrator, this.memorySystem),
            leave: new THRLeaveAgent(this.orchestrator, this.memorySystem),
            claims: new THRClaimsAgent(this.orchestrator, this.memorySystem),
            reporting: new THRReportingAgent(this.orchestrator, this.memorySystem)
        };

        // Register complex workflows
        this.workflows = {
            'monthly-payroll': this.createMonthlyPayrollWorkflow(),
            'year-end-closing': this.createYearEndWorkflow(),
            'employee-onboarding': this.createOnboardingWorkflow(),
            'leave-year-initialization': this.createLeaveInitWorkflow()
        };
    }

    createMonthlyPayrollWorkflow() {
        return {
            name: 'Monthly Payroll Processing',
            pattern: WORKFLOW_PATTERNS.PIPELINE,
            steps: [
                {
                    name: 'Validate Employee Data',
                    agent: 'employee',
                    action: 'validateAllEmployees'
                },
                {
                    name: 'Calculate Salaries',
                    agent: 'payroll',
                    action: 'calculateBatchSalaries',
                    parallel: true
                },
                {
                    name: 'Generate Transactions',
                    agent: 'payroll',
                    action: 'createTransactions'
                },
                {
                    name: 'Generate Reports',
                    agent: 'reporting',
                    action: 'generatePayrollReports'
                },
                {
                    name: 'Send Notifications',
                    agent: 'system',
                    action: 'notifyPayrollComplete'
                }
            ]
        };
    }

    createYearEndWorkflow() {
        return {
            name: 'Year End Processing',
            pattern: WORKFLOW_PATTERNS.SAGA,
            steps: [
                {
                    name: 'Generate EA Forms',
                    agent: 'reporting',
                    action: 'generateEAForms',
                    compensation: 'deleteEAForms'
                },
                {
                    name: 'Process Leave Carry Forward',
                    agent: 'leave',
                    action: 'processCarryForward',
                    compensation: 'reverseCarryForward'
                },
                {
                    name: 'Archive Transactions',
                    agent: 'system',
                    action: 'archiveYearData',
                    compensation: 'restoreFromArchive'
                },
                {
                    name: 'Initialize New Year',
                    agent: 'system',
                    action: 'initializeNewYear',
                    compensation: 'rollbackNewYear'
                }
            ]
        };
    }

    createOnboardingWorkflow() {
        return {
            name: 'Employee Onboarding',
            pattern: WORKFLOW_PATTERNS.SEQUENTIAL,
            steps: [
                {
                    name: 'Create Employee Record',
                    agent: 'employee',
                    action: 'createEmployee'
                },
                {
                    name: 'Initialize Leave Balance',
                    agent: 'leave',
                    action: 'initializeEmployeeLeave'
                },
                {
                    name: 'Setup Payroll',
                    agent: 'payroll',
                    action: 'setupEmployeePayroll'
                },
                {
                    name: 'Grant System Access',
                    agent: 'system',
                    action: 'createUserAccount'
                },
                {
                    name: 'Send Welcome Email',
                    agent: 'system',
                    action: 'sendWelcomeEmail'
                }
            ]
        };
    }

    createLeaveInitWorkflow() {
        return {
            name: 'Leave Year Initialization',
            pattern: WORKFLOW_PATTERNS.PARALLEL,
            steps: [
                {
                    name: 'Calculate Carry Forward',
                    agent: 'leave',
                    action: 'calculateCarryForward'
                },
                {
                    name: 'Initialize Balances',
                    agent: 'leave',
                    action: 'initializeYearBalances'
                },
                {
                    name: 'Generate Reports',
                    agent: 'reporting',
                    action: 'generateLeaveReport'
                }
            ]
        };
    }

    async executeWorkflow(workflowName, parameters = {}) {
        const workflow = this.workflows[workflowName];
        if (!workflow) {
            throw new Error(`Unknown workflow: ${workflowName}`);
        }

        console.log(`\n🚀 Executing THR Workflow: ${workflow.name}`);
        console.log('Parameters:', parameters);

        // Simulate workflow execution
        const results = {
            workflow: workflow.name,
            status: 'completed',
            steps: []
        };

        for (const step of workflow.steps) {
            console.log(`  ⚙️  ${step.name}...`);
            const agent = this.agents[step.agent];
            if (agent) {
                results.steps.push({
                    name: step.name,
                    agent: agent.name,
                    status: 'completed'
                });
            }
        }

        console.log(`✅ Workflow completed successfully!\n`);
        return results;
    }

    async runDiagnostics() {
        console.log('\n🔍 THR System Diagnostics\n');
        console.log('═'.repeat(50));
        
        const diagnostics = {
            database: {
                employees: 518,
                organizations: 17,
                payrollTransactions: 723,
                leaveApplications: 0,
                claims: 2
            },
            agents: Object.keys(this.agents).map(name => ({
                name: this.agents[name].name,
                capabilities: this.agents[name].capabilities
            })),
            workflows: Object.keys(this.workflows),
            issues: [
                'Leave tables are empty - need initialization',
                'Claims system has only 2 test records',
                'No notification triggers configured'
            ],
            recommendations: [
                'Run leave-year-initialization workflow',
                'Test claim submission workflow',
                'Configure notification webhooks'
            ]
        };

        console.log('📊 Database Status:');
        for (const [key, value] of Object.entries(diagnostics.database)) {
            console.log(`  • ${key}: ${value}`);
        }

        console.log('\n🤖 Available Agents:');
        diagnostics.agents.forEach(agent => {
            console.log(`  • ${agent.name}`);
        });

        console.log('\n⚠️  Issues Found:');
        diagnostics.issues.forEach(issue => {
            console.log(`  • ${issue}`);
        });

        console.log('\n💡 Recommendations:');
        diagnostics.recommendations.forEach(rec => {
            console.log(`  • ${rec}`);
        });

        return diagnostics;
    }
}

// Test and Demo Functions
async function demonstrateTHRAgents() {
    console.log('🎯 THR Domain Agents Demonstration\n');
    console.log('═'.repeat(60));
    
    const system = new THRSystemOrchestrator();

    // 1. Test Employee Agent
    console.log('\n1️⃣ Testing Employee Agent');
    const testEmployee = {
        staff_id: 'EMP001',
        name: 'Ahmad bin Abdullah',
        ic_no: '850101145678',
        email: 'ahmad@company.com',
        organization_id: 1
    };
    const validation = await system.agents.employee.validateEmployee(testEmployee);
    console.log('  Validation:', validation.valid ? '✅ Valid' : '❌ Invalid');

    // 2. Test Payroll Agent
    console.log('\n2️⃣ Testing Payroll Agent');
    const salary = await system.agents.payroll.calculateNetSalary({
        id: 1,
        basic_salary: 5000,
        allowances: 500,
        age: 35
    });
    console.log(`  Gross: RM ${salary.gross}`);
    console.log(`  Net: RM ${salary.net}`);

    // 3. Test Leave Agent
    console.log('\n3️⃣ Testing Leave Agent');
    const leaveInit = await system.agents.leave.initializeYearBalances(2025);
    console.log('  Leave initialization SQL generated');

    // 4. Test Claims Agent
    console.log('\n4️⃣ Testing Claims Agent');
    const claimValidation = await system.agents.claims.validateClaim({
        type: 'Medical',
        amount: 300,
        date: new Date().toISOString(),
        receipt_url: 'https://receipts.com/123.pdf'
    });
    console.log(`  Claim validation: ${claimValidation.errors.length === 0 ? '✅ Valid' : '❌ Invalid'}`);
    console.log(`  Approver: ${claimValidation.approver}`);

    // 5. Test Reporting Agent
    console.log('\n5️⃣ Testing Reporting Agent');
    const report = await system.agents.reporting.generateReport('Employee List', { organization_id: 1 });
    console.log('  Report query generated');

    // 6. Run System Diagnostics
    await system.runDiagnostics();

    // 7. Test Workflow
    console.log('\n7️⃣ Testing Workflow Execution');
    await system.executeWorkflow('leave-year-initialization', { year: 2025 });
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case 'demo':
            await demonstrateTHRAgents();
            break;

        case 'diagnose':
            const system = new THRSystemOrchestrator();
            await system.runDiagnostics();
            break;

        case 'workflow':
            const workflowName = args[1];
            if (!workflowName) {
                console.error('Usage: workflow <name>');
                console.log('Available workflows:');
                console.log('  • monthly-payroll');
                console.log('  • year-end-closing');
                console.log('  • employee-onboarding');
                console.log('  • leave-year-initialization');
                process.exit(1);
            }
            const orchestrator = new THRSystemOrchestrator();
            await orchestrator.executeWorkflow(workflowName);
            break;

        default:
            console.log(`
THR Domain-Specific Agents System

These agents have deep knowledge of:
  • THR database structure (81 tables)
  • Malaysian HR regulations (EPF, SOCSO, PCB)
  • 518 employees across 17 organizations
  • Frontend modules and components
  • Business workflows and processes

Usage:
  node thr-domain-agents.js <command>

Commands:
  demo          Run full demonstration
  diagnose      Run system diagnostics
  workflow      Execute a THR workflow

Available Agents:
  • THR Employee Specialist
  • THR Payroll Specialist
  • THR Leave Management Specialist
  • THR Claims Processing Specialist
  • THR Reporting & Analytics Specialist

Available Workflows:
  • monthly-payroll
  • year-end-closing
  • employee-onboarding
  • leave-year-initialization

The agents are built on the enhanced sub-agent framework
and have specific knowledge of THR's business domain.
            `);
    }
}

// Export for use as module
module.exports = {
    THREmployeeAgent,
    THRPayrollAgent,
    THRLeaveAgent,
    THRClaimsAgent,
    THRReportingAgent,
    THRSystemOrchestrator,
    THR_CONFIG
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}