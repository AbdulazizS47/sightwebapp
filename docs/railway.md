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
- `OTP_DEV_MODE=true` (only for testing without SMS)

Optional:
- `ADMIN_TOKEN`
- `ADMIN_PHONE`
- `OTP_TTL_MS`, `OTP_RESEND_MIN_MS`, `OTP_MAX_PER_HOUR`, `OTP_MAX_ATTEMPTS`, `OTP_PEPPER`

## 4. Web service (Vite frontend)
1. Add a **New Service → GitHub Repo** (same repo).
2. Set **Root Directory**: `/`
3. Set **Build Command**: `npm install && npm run build:web`
4. Set **Start Command**: `npm run start:web`
5. Add environment variables:
- `VITE_API_BASE_URL=https://api.sightcoffeespace.com/api`

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
- The `/uploads` directory is **ephemeral** on Railway. If you need to keep images forever, move uploads to S3/R2 later.

## 8. Quick checks
- API: `https://api.sightcoffeespace.com/api/health` should return 200.
- Web: `https://sightcoffeespace.com` should load.

