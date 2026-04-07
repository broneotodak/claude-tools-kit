# THR Photo Loading Optimization

## Quick Wins:

### 1. Add Loading State in UI
```jsx
// In PhotoUpload component
<Avatar
  src={avatarUrl}
  sx={{
    width: size,
    height: size,
    // Add loading animation
    opacity: loading ? 0.5 : 1,
    transition: 'opacity 0.3s ease-in-out',
  }}
/>
```

### 2. Use Supabase Image Transformation (if available)
```javascript
// Request smaller size for avatars
const thumbnailUrl = `${photoUrl}?width=200&height=200&quality=75`;
```

### 3. Lazy Loading for Images
```jsx
<Avatar
  src={avatarUrl}
  loading="lazy"  // Browser native lazy loading
/>
```

### 4. Consider Image Format
- Convert to WebP for better compression
- Use progressive JPEG for better perceived performance

### 5. Future Enhancements:
- Use Cloudinary or similar service for automatic optimization
- Implement proper thumbnail generation on upload
- Add image caching headers
- Use a CDN for faster delivery

### 6. Browser Caching
The current setup uses `cacheControl: '3600'` (1 hour). Could increase for profile photos:
```javascript
.upload(path, file, {
    cacheControl: '86400',  // 24 hours
    upsert: false,
})
```

For now, the photo is working! These optimizations can be implemented gradually as needed.