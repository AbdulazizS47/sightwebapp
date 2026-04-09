# Out Of Sight - System Features

## Customer Experience

- OTP sign-in for Saudi phone numbers
- Arabic and English interface
- Dynamic menu with categories, descriptions, pricing, and availability
- Cart and checkout flow
- Order confirmation and tracking
- Persistent account and order history

## Admin Operations

- Admin-only dashboard access by phone number role
- Live orders view
- Order history and customer summaries
- Menu CRUD
- Inventory management
- Store open-status scheduling
- Manual seed cleanup tools when explicitly enabled

## Backend

- Hono API running on Node.js
- MySQL persistence
- Server-side session storage with DB-backed session records
- OTP request throttling, expiry, and attempt limits
- Health endpoint with optional DB verification
- Image upload endpoint backed by the local `uploads` directory

## Printing

- Print jobs are created by the API
- Android print bridge polls the API from the tablet
- Bluetooth printer stays local to the tablet
- Print-job retry and stale-claim recovery are built into the API

## Deployment Characteristics

- Frontend and API can run on Railway
- MySQL is persistent
- Local uploads are not durable on Railway
- Production SMS delivery depends on the configured provider
