# Create Storage Buckets in Supabase

Follow these steps to create the required storage buckets:

## 1. Go to Supabase Dashboard
Open: https://supabase.com/dashboard/project/ftbtsxlujsnobujwekwx/storage/buckets

## 2. Create Employee Photos Bucket
- Click "New bucket"
- Name: `employee-photos`
- Public bucket: ✅ YES (check this)
- File size limit: 5MB
- Allowed MIME types: `image/jpeg, image/png, image/webp`
- Click "Create bucket"

## 3. Create Employee Documents Bucket
- Click "New bucket"
- Name: `employee-documents`
- Public bucket: ❌ NO (leave unchecked)
- File size limit: 10MB
- Allowed MIME types: `application/pdf, image/jpeg, image/png, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Click "Create bucket"

## 4. Create Company Assets Bucket
- Click "New bucket"
- Name: `company-assets`
- Public bucket: ✅ YES (check this)
- File size limit: 20MB
- Allowed MIME types: Leave empty (allow all)
- Click "Create bucket"

## 5. Set Bucket Policies

### For employee-photos (PUBLIC):
```sql
-- Allow authenticated users to upload their own photos
CREATE POLICY "Users can upload own photos" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'employee-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow all to view photos
CREATE POLICY "Photos are publicly accessible" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'employee-photos');

-- Allow users to update their own photos
CREATE POLICY "Users can update own photos" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'employee-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow users to delete their own photos
CREATE POLICY "Users can delete own photos" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'employee-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
```

### For employee-documents (PRIVATE):
```sql
-- Allow authenticated users to upload their own documents
CREATE POLICY "Users can upload own documents" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'employee-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow users to view their own documents
CREATE POLICY "Users can view own documents" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'employee-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow users to update their own documents
CREATE POLICY "Users can update own documents" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'employee-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow users to delete their own documents
CREATE POLICY "Users can delete own documents" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'employee-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
```

### For company-assets (PUBLIC):
```sql
-- Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload assets" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'company-assets');

-- Allow all to view assets
CREATE POLICY "Assets are publicly accessible" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'company-assets');

-- Allow authenticated users to update
CREATE POLICY "Authenticated users can update assets" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'company-assets');

-- Allow authenticated users to delete
CREATE POLICY "Authenticated users can delete assets" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'company-assets');
```

## Note: For Development
Since we don't have auth.users linked yet, you might want to temporarily allow anon access:

```sql
-- Temporary for development - REMOVE IN PRODUCTION
CREATE POLICY "Temp allow all for dev" ON storage.objects
FOR ALL TO anon
USING (bucket_id IN ('employee-photos', 'employee-documents', 'company-assets'))
WITH CHECK (bucket_id IN ('employee-photos', 'employee-documents', 'company-assets'));
```

## After Creating Buckets
Run this command to verify:
```bash
node /Users/broneotodak/Projects/claude-tools-kit/tools/thr-check-bucket-access.js
```