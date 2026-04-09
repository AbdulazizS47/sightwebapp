# Troubleshooting - Out Of Sight

## OTP Sign-In

### OTP was not received

- Confirm the phone number is a valid Saudi mobile number.
- Check that the server has a real SMS provider configured.
- If the environment is intentionally in debug mode, the code may be returned on screen instead of by SMS.

### OTP verification failed

- Make sure the code is six digits.
- Request a new code if the current one expired.
- Wait before retrying if rate limiting is triggered.

## Session Issues

### User is logged out unexpectedly

- Session tokens are stored in browser local storage.
- Clearing browser data or using private mode can remove them.
- If the API returns `401`, sign in again.

## Admin Dashboard

### Admin login works but dashboard access is denied

- The authenticated number must match `ADMIN_PHONE`.
- Check that the backend and frontend point to the same environment.

### Seed cleanup button is missing

- This is expected in production.
- It only appears when `VITE_ALLOW_SEED_MENU_TOOLS=true`.

## Images

### Image upload fails

- Use JPG, PNG, or WEBP only.
- Keep the final upload under 1 MB.
- Large source images are resized client-side, but some files may still be too large.

### Uploaded image disappears after redeploy

- Railway filesystem storage is ephemeral.
- The current `/uploads` directory is suitable for short-term storage only.
- Move media to S3 or R2 if persistence is required.

## Printing

### Orders are not printing

- Confirm the Android print bridge is running on the tablet.
- Verify the bridge uses the correct `Server URL`.
- Verify the bridge `Device Key` matches `PRINT_DEVICE_KEY`.
- Check printer pairing and Bluetooth permissions on the tablet.

### Test print works but live orders do not

- Confirm the API can create print jobs.
- Check that the print bridge can poll the API over HTTPS.
- Check the server logs for authentication or claim failures.

## Health Checks

### API looks up but orders fail

- Check `/api/health`.
- If DB checks are enabled, make sure the response reports `db: ok`.
- Validate MySQL connectivity and credentials.

## Useful Checks

```bash
npm run lint
npm run build
npm test -- --run
```

Server smoke checks:

- `GET /api/health`
- Admin sign-in
- Customer sign-in
- Create order
- Complete order
- Poll print queue from the tablet
