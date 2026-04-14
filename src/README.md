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
- `OTP_WEB_ORIGIN`
- `ADMIN_PHONE`
- `PRINT_DEVICE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

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
- Telegram order alerts send to the configured group chat after each successful order.
- `SMS_PROVIDER=console` should not be used on a live service unless you intentionally want OTPs logged instead of sent.
- For Android OTP suggestions, set `OTP_WEB_ORIGIN` to the customer-facing site host and make the SMS provider template end with `@your-domain #OTP_CODE`.

## Telegram Order Alerts

1. Create a bot in Telegram with BotFather and copy the token.
2. Add the bot to the staff group chat.
3. Send any message in the group, then get the group chat id from the bot updates or a Telegram chat-id helper bot.
4. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` on the API service.
5. Restart the API service and create a test order.

## Deployment

Use [docs/railway.md](/Users/abdulazizair/Desktop/SIGHT%20APP/docs/railway.md) as the deployment reference.
