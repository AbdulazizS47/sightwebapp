# Out Of Sight Application

This app is the production web and API codebase for Out Of Sight. It serves the customer ordering flow, the admin dashboard, and the API used by the Android print bridge.

## Current Stack

- Frontend: React + TypeScript + Vite
- API: Node.js + Hono
- Database: MySQL
- Deployment: Railway
- Image uploads: local `/uploads` directory exposed by the API
- Printing: Android print bridge on the tablet, connected to the Railway API over HTTPS

## Local Development

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run build
npm run lint
npm test -- --run
node ./src/server/index.js
```

## Key Application Areas

- Customer sign-in with OTP
- Bilingual Arabic and English UI
- Menu browsing and checkout
- Order history and tracking
- Admin order management
- Admin menu and inventory management
- Store open-hours settings
- Receipt printing queue for the Android bridge

## Environment Notes

Important server variables:

- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
- `PUBLIC_BASE_URL`
- `CORS_ORIGINS`
- `SMS_PROVIDER`
- `ADMIN_PHONE`
- `PRINT_DEVICE_KEY`

Optional diagnostics:

- `OTP_DEV_MODE=true` only for temporary non-production testing
- `OTP_DEBUG_RETURN_CODE=true` only for temporary non-production debugging
- `ALLOW_MENU_RESET=true` only when intentionally reseeding the baseline menu
- `ALLOW_SEED_MENU_TOOLS=true` only when intentionally exposing the seed-item cleanup action

Important frontend variables:

- `VITE_API_BASE_URL`
- `VITE_ENABLE_HEALTHCHECK`
- `VITE_ALLOW_SEED_MENU_TOOLS=true` only when intentionally exposing seed cleanup in the admin UI

## Production Notes

- Railway MySQL is persistent.
- The `/uploads` directory is not persistent on Railway. Move uploads to object storage if long-term retention is required.
- The Android print bridge must remain on the tablet because Bluetooth printing is local to the device.
- `SMS_PROVIDER=console` should not be used on a live service unless you intentionally want OTPs logged instead of sent.

## Deployment

Use [docs/railway.md](/Users/abdulazizair/Desktop/SIGHT%20APP/docs/railway.md) as the deployment reference.
