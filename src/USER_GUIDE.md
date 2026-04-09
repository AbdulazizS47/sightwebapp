# User Guide - Out Of Sight

## Getting Started

1. Open the website.
2. Choose Arabic or English from the header.
3. Sign in with your Saudi phone number.
4. Enter the OTP code sent to you.
5. Complete your name if this is your first sign-in.

## Ordering Flow

1. Browse the menu by category.
2. Add items to the cart.
3. Review quantities and totals.
4. Sign in if prompted.
5. Place the order.
6. Track the order from the order screen.

## Account Behavior

- Returning users keep their account and order history.
- Sessions are stored locally in the browser and renewed through the API.
- Language preference is stored locally in the browser.

## Admin Access

- Open `/#/admin-login` or `/#/dashboard`.
- Use the configured admin phone number.
- After sign-in, the dashboard gives access to orders, menu, inventory, customers, and settings.

## Order Status

- New orders are created as `received`.
- Staff can mark them `completed` from the admin dashboard.
- The print queue is managed separately for the Android bridge.

## Images

- Menu images are uploaded from the admin dashboard.
- Supported formats are JPG, PNG, and WEBP.
- Uploaded files are resized and validated before being sent to the API.

## Notes

- On production, OTP delivery should come from the configured SMS provider.
- In temporary staging or debug environments, a debug code may appear on screen if the backend is explicitly configured to return it.
- On Railway, uploaded files stored under `/uploads` are not durable long-term storage.
