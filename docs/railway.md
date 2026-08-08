# Railway Deployment (Frontend + API + MySQL)

This app can be fully hosted on Railway **except** the Android print-bridge, which must stay on the tablet (Bluetooth printer). The tablet will call the Railway API over HTTPS.

## 1. Create a Railway project
1. Push this repo to GitHub (if it isn't already).
2. In Railway, create a new Project → **Deploy from GitHub**.

## 2. Add MySQL
1. In the Railway project, add a **MySQL** service.
2. Railway will create database credentials for you.

## 3. API service (Node backend)
1. Add a **New Service → GitHub Repo** (same repo).
2. Set **Root Directory**: `/`
3. Set **Build Command**: `npm install`
4. Set **Start Command**: `npm run start:server`
5. Add environment variables:

Required:
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
  - Use Railway's **Add Reference** from the MySQL service.
- `PRINT_DEVICE_KEY` (must match the tablet)
- `CORS_ORIGINS=https://sightcoffeespace.com`

Recommended (OTP/SMS):
- `SMS_PROVIDER`
- `AUTHENTICA_API_KEY`
- `AUTHENTICA_TEMPLATE_ID`
- `AUTHENTICA_METHOD`
- `PUBLIC_BASE_URL=https://api.sightcoffeespace.com`

Optional (direct WhatsApp OTP via Meta, falls back to Authentica SMS above if unset or if
delivery fails — see `docs/whatsapp-otp-setup.md` for the full walkthrough):
- `WHATSAPP_CLOUD_API_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_OTP_TEMPLATE_NAME`
- `WHATSAPP_OTP_TEMPLATE_LANG_EN`, `WHATSAPP_OTP_TEMPLATE_LANG_AR`
- `WHATSAPP_OTP_TEMPLATE_HAS_BUTTON`
- `OTP_WEB_ORIGIN=sightcoffeespace.com`
- `OTP_DEV_MODE=false` on live Railway services
- `OTP_DEV_MODE=true` only for temporary testing without SMS

Telegram sales agent:
- Create a bot with Telegram's `@BotFather`, then set `TELEGRAM_BOT_TOKEN`.
- Send the bot a message and obtain your numeric owner chat ID, then set both
  `TELEGRAM_CHAT_ID` and `TELEGRAM_AGENT_CHAT_IDS` to that ID. Multiple IDs can be comma-separated.
- Set `TELEGRAM_AGENT_ENABLED=true`.
- Set `TELEGRAM_WEBHOOK_SECRET` to a long random value containing only letters, numbers,
  underscores, and hyphens.
- Set `TELEGRAM_DAILY_REPORT_TIME=09:00` (24-hour time). The bot sends the previous calendar
  day's report using the app's configured timezone (`Asia/Riyadh` by default).
- `PUBLIC_BASE_URL` must be the public HTTPS API origin. The API configures the Telegram webhook
  automatically at startup.

Available owner commands: `/today`, `/yesterday`, `/report YYYY-MM-DD`, and `/help`.

Optional AI operational manager:
- Create an OpenAI project API key and store it only on the API service as `OPENAI_API_KEY`.
- Set `OPENAI_OPERATIONAL_AGENT_ENABLED=true`.
- Set `OPENAI_OPERATIONAL_AGENT_MODEL=gpt-5.6-terra`.
- Set `OPENAI_OPERATIONAL_AGENT_REASONING=medium`.
- Redeploy the API service. The bot will then accept natural English and Arabic operational
  questions and the `/operations` command.
- Use `/reset` to clear the current Telegram conversation context.

The AI layer is read-only. It can query typed sales, open-order, inventory, inventory-risk,
movement, and data-quality tools. It cannot execute arbitrary SQL or change orders, inventory,
prices, discounts, settings, or customer communications.

For Android OTP keyboard suggestions/WebOTP, the Authentica SMS template should include the
customer-facing site host on the final line, for example `@sightcoffeespace.com #{{otp}}`.

Optional:
- `ADMIN_TOKEN`
- `ADMIN_PHONE`
- `ALLOW_SEED_MENU_TOOLS` only when you intentionally need the seed-item cleanup tool
- `OTP_TTL_MS`, `OTP_RESEND_MIN_MS`, `OTP_MAX_PER_HOUR`, `OTP_MAX_ATTEMPTS`, `OTP_PEPPER`

## 4. Web service (Vite frontend)
1. Add a **New Service → GitHub Repo** (same repo).
2. Set **Root Directory**: `/`
3. Set **Build Command**: `npm install && npm run build:web`
4. Set **Start Command**: `npm run start:web`
5. Add environment variables:
- `VITE_API_BASE_URL=https://api.sightcoffeespace.com/api`
- `VITE_ALLOW_SEED_MENU_TOOLS=false`

## 5. Custom domains + HTTPS
1. In Railway, open **API service → Domains** and add:
   - `api.sightcoffeespace.com`
2. Open **Web service → Domains** and add:
   - `sightcoffeespace.com`
   - (optional) `www.sightcoffeespace.com`
3. Railway will show target CNAMEs. Add them in your domain DNS.

## 6. Tablet (Print Bridge)
In the Android app:
- **Server URL**: `https://api.sightcoffeespace.com`
- **Device Key**: must match `PRINT_DEVICE_KEY`
- Make sure Bluetooth printer is paired and app shows **Polling**.

## 7. Notes about persistence
- MySQL on Railway **is persistent** (your orders history will stay).
- Uploaded menu images are stored in MySQL and served through `/uploads`, so they survive API deploys and restarts.
- The local `/uploads` directory is only a compatibility/cache layer and may be ephemeral on Railway.
- On the first deployment of this version, the API copies any still-accessible legacy images into MySQL. Legacy files that already return 404 must be re-uploaded once.

## 8. Quick checks
- API: `https://api.sightcoffeespace.com/api/health` should return 200.
- Web: `https://sightcoffeespace.com` should load.
- OTP delivery should use a real SMS provider, not `SMS_PROVIDER=console`.
