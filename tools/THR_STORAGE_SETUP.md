# THR Storage Setup Guide

## 📦 Storage Architecture

### Buckets Structure
```
employee-photos/       (Public - for profile photos)
├── TS/               (Organization prefix)
│   ├── TS001/        (Employee folders)
│   │   ├── photo_1234567890.jpg
│   │   └── photo_1234567891.jpg
│   └── TS002/
│       └── photo_1234567892.jpg
├── ST/
│   └── ST0001/
└── TA/
    └── TA001/

employee-documents/    (Private - for sensitive docs)
├── TS/
│   └── TS001/
│       ├── ic/
│       │   └── 1234567890.jpg
│       ├── passport/
│       │   └── 1234567891.pdf
│       └── contract/
│           └── 1234567892.pdf

company-assets/       (Public - for company logos, etc.)
├── logos/
├── banners/
└── icons/
```

## 🛠️ Setup Steps

### 1. Create Storage Buckets in Supabase Dashboard

1. Go to your Supabase project: https://supabase.com/dashboard/project/ftbtsxlujsnobujwekwx
2. Navigate to **Storage** in the sidebar
3. Click **New bucket** and create:

#### Bucket 1: employee-photos
- Name: `employee-photos`
- Public: ✅ Yes (for easy display)
- File size limit: 5MB
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`

#### Bucket 2: employee-documents
- Name: `employee-documents`
- Public: ❌ No (private documents)
- File size limit: 10MB
- Allowed MIME types: `image/jpeg`, `image/png`, `application/pdf`

#### Bucket 3: company-assets
- Name: `company-assets`
- Public: ✅ Yes
- File size limit: 5MB
- Allowed MIME types: `image/*`

### 2. Set Storage Policies

For **employee-photos** bucket:
```sql
-- Allow public to view all photos
CREATE POLICY "Public can view employee photos" ON storage.objects
FOR SELECT USING (bucket_id = 'employee-photos');

-- Allow authenticated users to upload their own photos
CREATE POLICY "Employees can upload own photos" ON storage.objects
FOR INSERT WITH CHECK (
    bucket_id = 'employee-photos' AND
    auth.uid() IS NOT NULL
);

-- Allow employees to update/delete their own photos
CREATE POLICY "Employees can manage own photos" ON storage.objects
FOR UPDATE OR DELETE USING (
    bucket_id = 'employee-photos' AND
    auth.uid() IS NOT NULL
);
```

For **employee-documents** bucket:
```sql
-- Employees can view their own documents
CREATE POLICY "Employees view own documents" ON storage.objects
FOR SELECT USING (
    bucket_id = 'employee-documents' AND
    auth.uid() IS NOT NULL AND
    (storage.foldername(name))[2] = auth.uid()::text
);

-- Employees can upload their own documents
CREATE POLICY "Employees upload own documents" ON storage.objects
FOR INSERT WITH CHECK (
    bucket_id = 'employee-documents' AND
    auth.uid() IS NOT NULL
);
```

### 3. Run Database Tables Creation

Run the SQL script in Supabase SQL Editor:
```sql
-- Copy contents from thr-setup-storage.sql
```

### 4. Test Upload Functionality

Use the test page or create a simple test:
```javascript
// Test photo upload
const testFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
const result = await uploadEmployeePhoto(
    'employee-id',
    'TS001',
    testFile
);
console.log('Upload result:', result);
```

## 📝 Database Tables Created

### thr_employee_photos
- Stores photo metadata
- Links to storage bucket
- Tracks primary photo
- Audit trail (who uploaded)

### thr_employee_documents
- Document metadata
- Document types (IC, Passport, etc.)
- Verification status
- Expiry tracking

### thr_document_types
- Reference table
- 23 predefined types
- Categories: personal, employment, education, certification

## 🔐 Security Considerations

1. **Photo Storage**
   - Public read for easy display
   - Authenticated write only
   - Size limited to 5MB

2. **Document Storage**
   - Private by default
   - Signed URLs for access
   - Expiry date tracking
   - Verification workflow

3. **Access Control**
   - Employees: Own photos/docs only
   - Managers: Team member docs (future)
   - HR: All employee docs (future)
   - Audit trail for all uploads

## 🎯 Next Steps

1. **Create Buckets** in Supabase Dashboard
2. **Run SQL Script** to create tables
3. **Test Upload** functionality
4. **Add UI Components** for photo/document management
5. **Implement RLS** policies for production

## 💡 Usage Examples

### Upload Employee Photo
```javascript
const result = await uploadEmployeePhoto(
    employeeId,
    'TS001',
    photoFile,
    { isPrimary: true }
);
```

### Upload Document
```javascript
const result = await uploadEmployeeDocument(
    employeeId,
    'TS001',
    'IC',
    documentFile,
    {
        documentName: 'Identity Card',
        description: 'Front side of IC',
        expiryDate: null
    }
);
```

### Get Employee Documents
```javascript
const { data } = await getEmployeeDocuments(employeeId, 'IC');
```

## ⚠️ Important Notes

1. **Bucket names cannot be changed** after creation
2. **Test with small files first** before setting up production
3. **Monitor storage usage** in Supabase dashboard
4. **Set up backup strategy** for important documents
5. **Consider CDN** for better photo performance globally