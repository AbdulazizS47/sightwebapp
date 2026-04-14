# Deployment Guide - Out Of Sight

This codebase is already structured for the live Railway deployment. The detailed platform-specific instructions live in [docs/railway.md](/Users/abdulazizair/Desktop/SIGHT%20APP/docs/railway.md).

## Production Checklist

API service:

- Set MySQL connection variables.
- Set `PUBLIC_BASE_URL`.
- Set `CORS_ORIGINS`.
- Set `ADMIN_PHONE`.
- Set `PRINT_DEVICE_KEY`.
- Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for new-order alerts.
- Set a real `SMS_PROVIDER`.
- Keep `OTP_DEV_MODE=false`.
- Keep `OTP_DEBUG_RETURN_CODE=false`.
- Keep `ALLOW_SEED_MENU_TOOLS=false` unless intentionally needed.

Web service:

- Set `VITE_API_BASE_URL`.
- Keep `VITE_ALLOW_SEED_MENU_TOOLS=false` unless intentionally needed.

Tablet:

- Point the Android print bridge to the Railway API domain.
- Use the same `PRINT_DEVICE_KEY` as the API.
- Confirm Bluetooth printer pairing.

## Smoke Tests

1. Load the public site.
2. Confirm `GET /api/health` returns healthy.
3. Request and verify OTP.
4. Create an order.
5. Confirm the Telegram group receives the new-order alert.
6. Complete the order from the dashboard.
7. Confirm the tablet claims and prints the job.

## Operational Notes

- Railway MySQL is persistent.
- Railway filesystem storage is not persistent. The current `/uploads` directory should be treated as temporary storage.
- Keep seed tools disabled on the live environment.
- Telegram order alerts are best-effort: checkout is not blocked if Telegram is unavailable.
