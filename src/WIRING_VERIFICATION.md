# Wiring Verification

## Current Integration Summary

- Frontend uses `src/utils/api.ts` for API base URL and feature flags.
- The React app manages language, session, cart state, routing, and admin access.
- The API serves customer, admin, upload, health, and print-queue endpoints.
- MySQL backs users, sessions, menu data, orders, and print jobs.
- The Android print bridge polls the API from the tablet and prints locally over Bluetooth.

## Core Flows

Customer flow:

1. Sign in with OTP.
2. Browse menu and place order.
3. Track the order by ID.

Admin flow:

1. Sign in with the configured admin phone.
2. Manage orders, menu, inventory, customers, and settings.
3. Mark orders completed and monitor store status.

Printing flow:

1. API creates print jobs for new orders.
2. Tablet claims pending jobs with `PRINT_DEVICE_KEY`.
3. Tablet prints and acknowledges completion.

## Verification Commands

```bash
npm run lint
npm run build
npm test -- --run
```

## Smoke Checks

- Public site loads.
- `/api/health` returns healthy.
- Customer OTP sign-in works.
- Admin dashboard login works.
- Order creation works.
- Print bridge claims and prints jobs.
