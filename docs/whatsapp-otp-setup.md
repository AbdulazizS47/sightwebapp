# Sending OTP via your own WhatsApp Business Account

This wires OTP delivery directly to Meta's WhatsApp Business Platform (Cloud API), using
SIGHT's own WhatsApp Business Account — no third-party SMS aggregator in the loop for this
channel. The code is already built and shipped
([`src/server/sms.js`](../src/server/sms.js)); it's disabled until the environment variables
below are set, and it never replaces SMS outright — Authentica stays as the automatic fallback
if a WhatsApp send fails for any reason (customer doesn't have WhatsApp, template not yet
approved, transient API error, etc.), so sign-in never breaks while this is being set up.

None of the setup below can be done from this repo or by an AI assistant — it all happens in
Meta's own dashboards and requires you to control the business phone number and pass Meta's
verification steps.

## 1. Meta Business Manager

1. Go to [business.facebook.com](https://business.facebook.com) and create (or use an existing)
   Business Manager account for SIGHT.
2. Under **Business Settings → Accounts → WhatsApp Accounts**, create a WhatsApp Business
   Account (WABA) if you don't already have one.

## 2. Add your phone number to WhatsApp Business Platform

1. In [Meta's WhatsApp Manager](https://business.facebook.com/wa/manage/), add a phone number to
   the WABA.
2. **Important:** a phone number can be used with the Cloud API *or* the regular WhatsApp
   Business consumer app, not both at once with full functionality. If the number you want to
   use (e.g. your existing SIGHT WhatsApp Business number) is currently active in the consumer
   app, Meta has a **"Migrate your number to the Cloud API"** flow in WhatsApp Manager — use
   that instead of adding it as a brand-new number, so you keep the number's existing chat
   history/verification and don't disrupt customers already messaging it.
3. Verify the number (Meta sends a verification code to it — SMS or voice call).

## 3. Get a permanent access token

The token you see in WhatsApp Manager's **API Setup / Quickstart** tab is temporary (~24 hours)
and is only for testing. For production you need a **permanent token**:

1. **Business Settings → Users → System Users** → create a System User (e.g. "sight-api").
2. Assign it the WABA, with **Full control** (or at least `whatsapp_business_messaging` +
   `whatsapp_business_management` permissions).
3. Generate a token for that System User, scoped to those permissions, with **no expiration**.
4. Save it immediately — Meta only shows it once. This is `WHATSAPP_CLOUD_API_TOKEN`.
5. In WhatsApp Manager → your phone number's details, copy the **Phone Number ID** (a numeric
   ID, not the phone number itself) — this is `WHATSAPP_PHONE_NUMBER_ID`.

## 4. Create and submit the OTP template

WhatsApp requires a **pre-approved message template** for any business-initiated message like an
OTP — you cannot send free-form text for this. Use the **Authentication** category specifically;
Meta auto-generates the compliant wording for that category rather than letting you write
arbitrary body text.

1. WhatsApp Manager → **Message Templates → Create Template**.
2. Category: **Authentication**.
3. Add one **English** version and one **Arabic** version (same template name, two language
   variants — or two separately named templates if you'd rather keep them distinct; either
   works, just make sure the language codes below match what you actually submitted).
4. Meta will offer:
   - The verification code variable (this becomes `{{1}}` in the body — the code is inserted
     here automatically).
   - Optional: a **security recommendation** footer (e.g. "For your security, do not share this
     code.").
   - Optional: a **Copy Code** button. If you add it, set `WHATSAPP_OTP_TEMPLATE_HAS_BUTTON=true`
     below — the API call must include button parameters when the approved template has one, and
     must omit them when it doesn't, so this needs to match exactly what got approved.
   - Code expiration notice (minutes) — optional, cosmetic only; this app's own `OTP_TTL_MS`
     setting is the value that's actually enforced.
5. Submit for review. Authentication-template review is usually fast (minutes to a few hours),
   but can take longer — Meta doesn't publish a guaranteed SLA.
6. Note the exact **template name** and the **language code(s)** you submitted under (commonly
   `en_US` for English and `ar` for Arabic — confirm the exact codes Meta assigned yours, in case
   they differ).

## 5. Set the environment variables

On the **API service** in Railway (same service that already has `AUTHENTICA_API_KEY` etc.):

```
WHATSAPP_CLOUD_API_TOKEN=<the permanent System User token from step 3>
WHATSAPP_PHONE_NUMBER_ID=<the numeric Phone Number ID from step 3>
WHATSAPP_OTP_TEMPLATE_NAME=<the template name from step 4>
WHATSAPP_OTP_TEMPLATE_LANG_EN=en_US
WHATSAPP_OTP_TEMPLATE_LANG_AR=ar
WHATSAPP_OTP_TEMPLATE_HAS_BUTTON=false
```

Leave `WHATSAPP_OTP_TEMPLATE_HAS_BUTTON=false` unless you actually added a Copy Code button to
the approved template (step 4). Redeploy the API service after setting these.

Until `WHATSAPP_CLOUD_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_OTP_TEMPLATE_NAME`
are all set, the app behaves exactly as it does today — OTPs go out over Authentica SMS only.
Once all three are set, every OTP tries WhatsApp first and only falls back to SMS if that send
fails.

## 6. Test it

1. While your WABA is still in Meta's default sandbox/testing tier, you can only message phone
   numbers you've explicitly added as **test numbers** in WhatsApp Manager — add your own phone
   there first.
2. Trigger a sign-in on the live site with that test number and confirm the code arrives on
   WhatsApp.
3. Check the API service logs for `WhatsApp OTP delivery failed for ...` — if you see that on
   every attempt, the fallback to SMS is working but WhatsApp itself needs another look (wrong
   template name/language code is the most common cause).

## 7. Business verification, limits, and cost

- Sending to **any** customer number (not just added test numbers) requires your Business
  Manager to complete **Meta Business Verification**, and the WABA to be in production
  (not the default limited/sandbox tier).
- New WABAs start with a **messaging limit tier** (a cap on how many unique customers you can
  message in a rolling 24 hours) that increases automatically as your template's quality rating
  stays healthy — don't assume unlimited volume on day one.
- Meta charges **per conversation** for template messages once you're past the free tier
  included with a verified business, priced per country/category and billed via your connected
  payment method in Business Manager. Check current WhatsApp Business Platform pricing in Meta's
  own billing dashboard before relying on this at volume — pricing isn't something this repo can
  track for you.
