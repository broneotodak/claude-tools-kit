# THR Integration with Claude Tools Kit

This repository contains tools for the THR (Todak Human Resources) system migration and integration.

## What is THR?

THR is a comprehensive Human Resource Management System being developed to replace the legacy HR2000 system. It includes:
- Employee management
- Payroll processing
- Leave management
- Asset tracking (ATLAS integration)
- Accounting integration

## Repository Structure

```
claude-tools-kit/
├── tools/
│   ├── thr-*.js          # All THR-related tools
│   ├── memory-*.js       # Memory management tools
│   └── ...
├── config/
│   └── supabase-security.js  # Secure Supabase client
├── backups/              # Backup files (gitignored)
└── THR-TOOLS.md         # Detailed THR tools documentation
```

## Setup for New Machine

1. Clone the repository:
```bash
git clone https://github.com/broneotodak/claude-tools-kit.git
cd claude-tools-kit
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```bash
# Copy from .env.template
cp .env.template .env
# Edit .env with your credentials
```

4. Required environment variables:
```
ATLAS_SUPABASE_URL=your_thr_database_url
ATLAS_SUPABASE_SERVICE_ROLE_KEY=your_service_key
SUPABASE_PROJECT_ID=your_memory_database_id
SUPABASE_SERVICE_ROLE_KEY=your_memory_service_key
```

## Key THR Tools

### Employee Migration
```bash
node tools/thr-migrate-employees.js
```

### Schema Management
```bash
node tools/thr-create-complete-schema.js
node tools/thr-rebuild-schema.js
```

### Data Analysis
```bash
node tools/thr-migration-summary.js
node tools/thr-comprehensive-analyzer.js
```

## Current Status

- ✅ 518 employees migrated to new structure
- ✅ Clean schema with proper naming (thr_, thr_acc_, thr_atlas_)
- ✅ Reference data populated
- 🔄 Ready for frontend/backend development
- 🔄 Auth integration pending

## Integration with THR Repository

The actual THR application should be developed in the separate repository:
https://github.com/broneotodak/THR

This CTK repository contains:
- Migration tools
- Database utilities
- Memory management
- Development tools

The THR repository should contain:
- Frontend application
- Backend API
- Business logic
- UI components

## Memory System

THR progress is saved in the Claude memory system:
- Category: "THR"
- Importance: 6 (High)
- Auto-synced across machines via Supabase

To check THR memories:
```bash
node tools/check-memory.js THR
```

## Support

For issues or questions about THR tools, check:
1. THR-TOOLS.md for detailed documentation
2. Individual tool files for usage
3. Memory system for context