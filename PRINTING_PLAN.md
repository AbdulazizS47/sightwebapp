# Bluetooth Printing Plan (Android Tablet + ESC/POS)

## Context

- Printer: **Eacam JK-5803P** (ESC/POS)
- Device: **Android 15 tablet**, Wi‑Fi connected
- Paper width: **57mm**
- Receipt: **Arabic + English**
- Logo: **Top only**
- Goal: Every order prints automatically and reliably.

---

## Phase 1 — Server Print Queue (MySQL)

### 1.1 Schema

Create `print_jobs` table:

- `id` (PK, auto)
- `orderId` (FK -> orders.id)
- `status` (`pending|printing|printed|failed`)
- `attempts` (int)
- `lastError` (text)
- `claimedAt` (timestamp)
- `printedAt` (timestamp)
- `createdAt` (timestamp)

### 1.2 Queue insertion

When `/api/orders/create` succeeds:

- Insert `print_jobs` row with `status = pending`.
- Use `orderId` for linkage.

### 1.3 Security

- Add `PRINT_DEVICE_KEY` in env.
- Require `X-Device-Key` header for all print endpoints.

---

## Phase 2 — Print API Endpoints

### 2.1 Claim job

**POST** `/api/print/jobs/claim`

- Auth: `X-Device-Key`
- Returns the next pending job with its order payload.
- Atomically set `status=printing`, `claimedAt=now`.

### 2.2 Acknowledge success

**POST** `/api/print/jobs/:id/ack`

- Marks `status=printed`, `printedAt=now`.

### 2.3 Report failure

**POST** `/api/print/jobs/:id/fail`

- Increment `attempts`, set `status=failed`, store `lastError`.
- Optional retry if `attempts < MAX`.

---

## Phase 3 — Android Print Bridge (Kotlin)

### 3.1 Pairing & Setup UI

- List paired Bluetooth devices
- Select JK‑5803P
- Save MAC address

### 3.2 Polling Loop

- Poll `/api/print/jobs/claim` every 3–5 seconds
- If job returned → print → ack/fail
- Retry with backoff if printer unavailable

### 3.3 Print Pipeline

- Render receipt as **bitmap** (Arabic shaping + logo)
- Convert to ESC/POS raster format
- Send to Bluetooth socket

### 3.4 Status UI

- Connected / disconnected status
- Last print time + last error
- Manual “Reprint last job”

---

## Phase 4 — Receipt Layout (57mm)

### 4.1 Header

- Logo centered
- Store name (Arabic + English)

### 4.2 Order Details

- Order number
- Date/time
- Items list (qty × item name + price)

### 4.3 Totals

- Subtotal
- VAT (15%)
- Total

### 4.4 Footer

- Status line
- “Thank you” (Arabic + English)

---

## Phase 5 — Admin Dashboard Support

- Show print status per order
- “Reprint” button creates a new print job
- Error indicator when print failed

---

## Rollout Steps

1. Implement Phase 1 + 2 in server (DB + APIs).
2. Build Android print bridge MVP.
3. Test with real printer + sample orders.
4. Add Admin reprint UI.

---

## Open Decisions

- Polling vs WebSocket
  **Recommendation:** Polling (reliable, easier).

- Retry policy
  e.g., max 3 attempts, then mark failed.

- Bitmap font + RTL shaping
  Use an Arabic-capable font in rendering.

---

# Android Print Bridge Requirements (Detailed)

## 1) Core Function

- Connect to paired Bluetooth ESC/POS printer
- Poll server for pending jobs
- Print receipts automatically
- ACK/FAIL to server

## 2) Bluetooth

- Use Bluetooth Classic (SPP)
- Store printer MAC
- Auto‑reconnect
- Show connection status

## 3) Server Integration

- `POST /api/print/jobs/claim`
- `POST /api/print/jobs/:id/ack`
- `POST /api/print/jobs/:id/fail`
- Header: `X-Device-Key`

## 4) Receipt Content (Arabic + English)

- Logo at top
- Order number + receipt number
- Date/time
- Items list (qty × item name + line total)
- Subtotal, VAT, total
- Payment method
- Status line
- Thank you

## 5) Arabic Support

- Use bitmap rendering to avoid broken shaping
- Bundle Arabic font (Cairo or Noto Naskh)
- Draw RTL with `StaticLayout`

## 6) Format (57mm)

- Max width ~384px @ 203dpi
- Logo scaled to fit

## 7) App UI

- Printer select screen
- Server URL + device key config
- Test print button
- Last job status

## 8) Background Operation

- Foreground service recommended
- Auto start on boot (optional)

## 9) Error Handling

- On error → `/fail` with message
- On success → `/ack`

## 10) Security

- Store device key securely
- Use HTTPS in production
