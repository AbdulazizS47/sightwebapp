# Profiles and Loyalty Cards Implementation Plan

This document outlines the plan to add persistent user profiles and a loyalty program to the SIGHT APP, broken into segments we can deliver one by one.

## Current State Summary

- Authentication: Demo OTP and in-memory sessions. Role is derived from ADMIN_PHONE; otherwise user.
- Orders: Stored in MySQL `orders` table and linked optionally to `userId` and `phoneNumber`.
- Customers (Admin): Aggregated from orders by phone number.
- Menu: Categories and items persist in MySQL.

## Target Capabilities

- Persistent Users table with profile fields.
- Profile API (view/update) that persists to DB.
- Loyalty account (enable/disable) with points and tier.
- Orders link to session user reliably; points accrual when loyalty enabled.

## Deliverable Segments

1. Users & Loyalty DB Schema
   - Add `users` and `loyalty_accounts` tables.
   - Backfill rules will be defined later if needed.

2. Profile Endpoints
   - `GET /api/profile` to fetch user profile (auth required).
   - `PUT /api/profile` to update name/email/language.
   - Persist user creation on OTP verification; persist updates on profile changes.

3. Loyalty Enable/Disable Endpoints
   - `POST /api/profile/loyalty/enable` to enroll user and mark enabled.
   - `POST /api/profile/loyalty/disable` to mark disabled.

4. Orders Linking to Session
   - Derive `userId` and `phoneNumber` from the session on order creation.
   - Keep compatibility by falling back to body-provided phoneNumber when no session.

5. Points Accrual Logic
   - Accrue points on each order when loyalty is enabled.
   - Define configurable earn rate and future tier thresholds.

6. Admin Customers View Update
   - Build customers view from `users` + `orders` (show loyalty status and tier).

## Initial DB Schema (Proposed)

- `users`
  - id (PK, e.g., `user:{phone}`)
  - phoneNumber (UNIQUE, NOT NULL)
  - name (NOT NULL)
  - email (NULL)
  - language (NULL)
  - role (NOT NULL)
  - createdAt (BIGINT)
  - updatedAt (BIGINT)

- `loyalty_accounts`
  - userId (PK, FK users.id)
  - points (INT, default 0)
  - tier (VARCHAR, default 'basic')
  - enabled (TINYINT, default 0)
  - enrollmentDate (BIGINT, NULL)

## API Endpoints (Planned)

- Auth & Sessions
  - Persist users on OTP verification.
  - Update users on complete profile.

- Profile
  - `GET /api/profile` (Authorization: Bearer session token)
  - `PUT /api/profile` (name, email, language)

- Loyalty
  - `POST /api/profile/loyalty/enable`
  - `POST /api/profile/loyalty/disable`

- Orders
  - `POST /api/orders/create` derives session userId/phoneNumber if present.

## Acceptance Criteria per Segment

1. Users & Loyalty DB Schema

- Tables created successfully on server init.
- No runtime errors; health check remains healthy.

2. Profile Endpoints

- OTP verification upserts `users`.
- `GET /api/profile` returns stored profile.
- `PUT /api/profile` updates name/email/language and persists.

3. Loyalty Enable/Disable

- Enable creates/upserts `loyalty_accounts` with enabled=1.
- Disable sets enabled=0.

4. Orders Linking

- Orders created with userId/phoneNumber from session when available.
- Backward compatibility maintained without session.

5. Points Accrual

- Points increment on order creation for enabled accounts.

6. Admin Customers Update

- Admin customers view shows loyalty status/tier alongside orders.

## Security & Secrets

- No secrets in logs. Use environment variables for configuration.

## Rollout Plan

- Implement Segment 1–4 first (backend scaffolding).
- Keep UI minimal until we design the Profile and Wallet card.
- Add Segment 5–6 next with tests.

## Next Action

- Implement Segment 1 now: create the new tables and wire persistence in OTP and profile endpoints.
