# Troubleshooting Guide - Out Of Sight

## Common Issues & Solutions

### Authentication Issues

#### Issue: "Failed to update profile" error
**Solution**: The system has a graceful fallback. Even if the error appears, the authentication will proceed with a local user profile update. Simply continue using the app.

**Why it happens**: The backend might be initializing or there could be a temporary network issue.

**Fix**: 
- The app will still work - your name is stored locally
- On next interaction, the backend will sync automatically
- No action needed from user side

---

#### Issue: OTP not appearing
**Solution**: 
1. Make sure you've clicked "Send Code"
2. The OTP appears in a gray box below the input field
3. Code is 6 digits

**Demo Mode**: All OTPs are displayed on screen - no SMS is sent.

---

#### Issue: Can't sign in after entering OTP
**Solution**:
1. Verify the OTP code matches exactly (6 digits)
2. OTP expires after 5 minutes - request a new one
3. Check browser console for detailed error messages

---

### Admin Panel Issues

#### Issue: Can't see the Settings icon
**Solution**:
1. Make sure you're on the **Landing Page** (not Menu or Contact)
2. The ⚙️ icon appears in the **bottom-right corner**
3. You must be **signed in** first
4. Icon is circular with espresso brown background

**Steps**:
- Sign in → Go to Landing Page → Look for ⚙️ bottom-right

---

#### Issue: Images not uploading in Admin Panel
**Solution**:
1. File size limit: Keep images under 5MB
2. Supported formats: JPEG, PNG, WebP, GIF
3. Check browser console for error messages
4. Ensure stable internet connection

**Troubleshooting**:
- Try a smaller image file
- Try a different image format
- Refresh the page and try again

---

#### Issue: Menu items not appearing after adding
**Solution**:
1. Make sure you clicked "Save" after adding item
2. Refresh the menu page
3. Check that all required fields are filled:
   - English Name
   - Arabic Name
   - English Description
   - Arabic Description
   - Price
   - Category selection

---

### Cart & Checkout Issues

#### Issue: Cart not showing items
**Solution**:
1. Make sure you clicked "Add to Cart" on menu items
2. Cart icon shows item count in top-right
3. Click the cart icon or "View Cart" button
4. Items persist across page navigation

---

#### Issue: Can't complete checkout
**Solution**:
1. Must be signed in to checkout
2. Cart cannot be empty
3. All fields must be filled
4. Select a payment method

**Required fields**:
- Customer name (auto-filled if signed in)
- Delivery address
- Phone number
- Payment method selection

---

### Display Issues

#### Issue: Arabic text not displaying correctly
**Solution**:
1. Click the language toggle (🌐 globe icon) in top-right
2. Select Arabic language
3. Page should flip to RTL (right-to-left) layout
4. Font should change to Tajawal

**If still broken**:
- Clear browser cache
- Refresh the page
- Check that Tajawal font is loading

---

#### Issue: Images not loading
**Solution**:
1. Check internet connection
2. Images are served from Supabase Storage
3. Signed URLs expire after 1 hour - refresh to get new URLs
4. Default placeholder shows if image fails to load

---

### Order Issues

#### Issue: Order not appearing in Admin Panel
**Solution**:
1. Refresh the Admin Panel
2. Check the correct status filter is selected
3. New orders appear as "Pending" status
4. Orders are sorted by newest first

---

#### Issue: Can't update order status
**Solution**:
1. Click directly on the status button/dropdown
2. Select new status from the list
3. Status updates immediately - no save button needed
4. Check browser console if update fails

**Status flow**:
```
Pending → Preparing → Ready → Delivered
```

---

### Performance Issues

#### Issue: App running slow
**Solution**:
1. Close unnecessary browser tabs
2. Clear browser cache
3. Use latest version of Chrome, Safari, or Firefox
4. Check internet connection speed

---

#### Issue: Images loading slowly
**Solution**:
1. Images are optimized automatically
2. Initial load may take time
3. Subsequent loads use browser cache
4. Consider using smaller image files (admin)

---

## Browser Compatibility

### Recommended Browsers:
- ✅ Chrome 90+
- ✅ Safari 14+
- ✅ Firefox 88+
- ✅ Edge 90+

### Mobile Browsers:
- ✅ Safari iOS 14+
- ✅ Chrome Android 90+
- ✅ Samsung Internet 14+

---

## Debug Mode

### Enable Debug Logging:
Open browser Developer Tools:
- **Chrome/Edge**: F12 or Ctrl+Shift+I (Cmd+Option+I on Mac)
- **Firefox**: F12 or Ctrl+Shift+K (Cmd+Option+K on Mac)
- **Safari**: Cmd+Option+I

Go to **Console** tab to see detailed logs for:
- Authentication flows
- API requests/responses
- Image uploads
- Order creation
- Menu updates

---

## Network Issues

### Issue: "Failed to fetch" errors
**Solution**:
1. Check internet connection
2. Verify Supabase service is running
3. Check browser console for CORS errors
4. Try refreshing the page

**API Endpoint**: All requests go to:
```
https://{projectId}.supabase.co/functions/v1/make-server-acfed4d8/*
```

---

## Data Issues

### Issue: Lost cart items
**Solution**:
- Cart is stored in component state (memory)
- Refreshing page will clear cart
- This is by design - no persistent cart storage yet
- To add: localStorage persistence (future enhancement)

---

### Issue: Session expired
**Solution**:
1. Sessions last 30 days
2. Sign in again to create new session
3. Previous orders are preserved
4. User data is maintained

---

## Still Having Issues?

### Check These:
1. ✅ Browser console for error messages
2. ✅ Network tab for failed requests
3. ✅ Internet connection stability
4. ✅ Browser cache (try clearing)
5. ✅ Using supported browser version

### Debug Information to Collect:
- Browser name and version
- Error messages from console
- Steps to reproduce the issue
- Screenshots of the problem
- Network request details (from Network tab)

---

## Quick Fixes

### General Troubleshooting Steps:
1. **Refresh the page** (Ctrl+R or Cmd+R)
2. **Clear cache** (Ctrl+Shift+Delete)
3. **Sign out and sign in again**
4. **Try a different browser**
5. **Check browser console for errors**
6. **Verify internet connection**

### Reset Everything:
```javascript
// In browser console, run:
localStorage.clear()
location.reload()
```

This will:
- Clear session token
- Sign you out
- Reset any cached data
- Reload the page fresh

---

## Known Limitations

### Demo Mode:
- OTP codes are displayed (no real SMS)
- Payment methods don't process real transactions
- Image uploads limited by Supabase free tier
- No email notifications

### Architecture:
- KV store has limited query capabilities
- Images must be under reasonable size
- Session management is simplified
- No real-time WebSocket updates (uses polling)

---

## Feature Requests

For production deployment, consider adding:
- Real SMS integration (Twilio, AWS SNS)
- Payment gateway integration (Stripe, PayPal, local Saudi gateways)
- Email notifications (SendGrid, AWS SES)
- Push notifications for orders
- Persistent cart storage
- Advanced order filtering
- Sales analytics dashboard
- Customer review system
- Loyalty program
- Multi-location support

---

**This system is fully functional for demo and testing purposes!**

If you encounter issues not covered here, check the browser console for detailed error messages and debugging information.
