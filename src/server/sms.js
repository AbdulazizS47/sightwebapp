import 'dotenv/config';

const provider = (process.env.SMS_PROVIDER || 'console').trim().toLowerCase();

function normalizeWebOtpOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).host;
  } catch {
    return raw
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .trim();
  }
}

function getWebOtpLine(code) {
  const origin = normalizeWebOtpOrigin(
    process.env.OTP_WEB_ORIGIN ||
      process.env.WEB_OTP_ORIGIN ||
      process.env.APP_PUBLIC_ORIGIN ||
      process.env.FRONTEND_ORIGIN ||
      process.env.PUBLIC_APP_URL
  );

  return origin ? `\n\n@${origin} #${code}` : '';
}

function buildMessage(code, language) {
  const tpl = (process.env.OTP_MESSAGE_TEMPLATE || '').trim();
  const webOtpLine = getWebOtpLine(code);
  if (tpl) {
    const message = tpl
      .replace(/\{code\}/g, code)
      .replace(/\{web_otp_line\}/g, webOtpLine)
      .replace(/\{otp_origin\}/g, webOtpLine.trim().replace(/^@/, '').replace(/\s+#.+$/, ''));
    return message.includes(webOtpLine.trim()) ? message : `${message}${webOtpLine}`;
  }

  if (language === 'ar') return `رمز التحقق الخاص بك هو: ${code}${webOtpLine}`;
  return `Your SIGHT verification code is: ${code}${webOtpLine}`;
}

// Direct WhatsApp Business Platform (Meta Cloud API) delivery — sends from the business's own
// WhatsApp Business Account, no third-party SMS aggregator involved. Requires a pre-approved
// "Authentication" category template in Meta's WhatsApp Manager; see docs/whatsapp-otp-setup.md.
const WHATSAPP_GRAPH_API_VERSION = (process.env.WHATSAPP_GRAPH_API_VERSION || 'v21.0').trim();
const WHATSAPP_CLOUD_API_TOKEN = (process.env.WHATSAPP_CLOUD_API_TOKEN || '').trim();
const WHATSAPP_PHONE_NUMBER_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
const WHATSAPP_OTP_TEMPLATE_NAME = (process.env.WHATSAPP_OTP_TEMPLATE_NAME || '').trim();
const WHATSAPP_OTP_TEMPLATE_LANG_EN = (process.env.WHATSAPP_OTP_TEMPLATE_LANG_EN || 'en_US').trim();
const WHATSAPP_OTP_TEMPLATE_LANG_AR = (process.env.WHATSAPP_OTP_TEMPLATE_LANG_AR || 'ar').trim();
// Meta requires the button's parameters to be included only when the approved template actually
// has a "Copy Code" button — sending them for a button-less template (or omitting them for one
// that has a button) is rejected by the API, so this must match what was actually approved.
const WHATSAPP_OTP_TEMPLATE_HAS_BUTTON =
  (process.env.WHATSAPP_OTP_TEMPLATE_HAS_BUTTON || '').trim().toLowerCase() === 'true';

export const WHATSAPP_CLOUD_CONFIGURED = Boolean(
  WHATSAPP_CLOUD_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_OTP_TEMPLATE_NAME
);

async function sendViaWhatsAppCloud({ phoneNumber, code, language }) {
  if (!WHATSAPP_CLOUD_CONFIGURED) {
    throw new Error('WhatsApp Cloud API is not configured');
  }

  const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const templateLanguage = language === 'ar' ? WHATSAPP_OTP_TEMPLATE_LANG_AR : WHATSAPP_OTP_TEMPLATE_LANG_EN;

  const components = [
    {
      type: 'body',
      parameters: [{ type: 'text', text: code }],
    },
  ];
  if (WHATSAPP_OTP_TEMPLATE_HAS_BUTTON) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: code }],
    });
  }

  const to = phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber;
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: WHATSAPP_OTP_TEMPLATE_NAME,
      language: { code: templateLanguage },
      components,
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WHATSAPP_CLOUD_API_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`WhatsApp Cloud API OTP failed: HTTP ${resp.status} ${txt}`);
  }

  return true;
}

// Broadcast/marketing messages — same WhatsApp Business Account and Cloud API credentials as
// the OTP sender above, but a separate "Marketing" category template (Meta reviews and prices
// Marketing templates differently from Authentication ones; see docs/whatsapp-otp-setup.md).
// The approved template is expected to have exactly one body variable ({{1}}) that the whole
// composed message text is passed into.
const WHATSAPP_MARKETING_TEMPLATE_NAME = (process.env.WHATSAPP_MARKETING_TEMPLATE_NAME || '').trim();
const WHATSAPP_MARKETING_TEMPLATE_LANG_EN = (
  process.env.WHATSAPP_MARKETING_TEMPLATE_LANG_EN || 'en_US'
).trim();
const WHATSAPP_MARKETING_TEMPLATE_LANG_AR = (
  process.env.WHATSAPP_MARKETING_TEMPLATE_LANG_AR || 'ar'
).trim();

export const WHATSAPP_MARKETING_CONFIGURED = Boolean(
  WHATSAPP_CLOUD_API_TOKEN && WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_MARKETING_TEMPLATE_NAME
);

export async function sendWhatsAppMarketingMessage({ phoneNumber, bodyText, language }) {
  if (!WHATSAPP_MARKETING_CONFIGURED) {
    throw new Error('WhatsApp marketing template is not configured');
  }

  const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const templateLanguage =
    language === 'ar' ? WHATSAPP_MARKETING_TEMPLATE_LANG_AR : WHATSAPP_MARKETING_TEMPLATE_LANG_EN;
  const to = phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber;

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: WHATSAPP_MARKETING_TEMPLATE_NAME,
      language: { code: templateLanguage },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: bodyText }],
        },
      ],
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WHATSAPP_CLOUD_API_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`WhatsApp Cloud API broadcast failed: HTTP ${resp.status} ${txt}`);
  }

  return true;
}

async function sendViaAuthentica({ phoneNumber, code, language, method: methodOverride }) {
  const url = (
    process.env.AUTHENTICA_SEND_URL ||
    process.env.AUTHENTICASA_SEND_URL ||
    'https://api.authentica.sa/api/v2/send-otp'
  )
    .trim()
    .replace(/^(?!https?:\/\/)/, 'https://');

  const apiKey = (process.env.AUTHENTICA_API_KEY || process.env.AUTHENTICASA_API_KEY || '').trim();
  const templateId =
    Number(process.env.AUTHENTICA_TEMPLATE_ID || process.env.AUTHENTICASA_TEMPLATE_ID || 1) || 1;
  const method = (methodOverride || process.env.AUTHENTICA_METHOD || 'sms').trim().toLowerCase();
  const fallbackPhone = (process.env.AUTHENTICA_FALLBACK_PHONE || '').trim();
  const fallbackEmail = (process.env.AUTHENTICA_FALLBACK_EMAIL || '').trim();

  if (!apiKey) throw new Error('AUTHENTICA_API_KEY is not set');

  const body = {
    method,
    phone: phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`,
    template_id: templateId,
    otp: code,
    ...(fallbackPhone ? { fallback_phone: fallbackPhone } : {}),
    ...(fallbackEmail ? { fallback_email: fallbackEmail } : {}),
    // best-effort: some setups may respect language-specific templates
    ...(language === 'ar' ? { language: 'ar' } : {}),
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Authorization': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Authentica OTP failed: HTTP ${resp.status} ${txt}`);
  }

  return true;
}

async function sendViaFallbackProvider({ phoneNumber, code, language, method }) {
  if (provider === 'console') {
    const message = buildMessage(code, language);
    console.log(`[OTP] ${phoneNumber}: ${message}`);
    return true;
  }

  if (provider === 'authentica' || provider === 'authenticasa') {
    return sendViaAuthentica({ phoneNumber, code, language, method });
  }

  throw new Error(`Unsupported SMS_PROVIDER: ${provider}`);
}

// Tries the business's own WhatsApp Business Account first (when configured), falling back to
// the SMS_PROVIDER (Authentica, or console in dev) so a WhatsApp outage or an unconfigured
// template never blocks sign-in.
export async function sendOtpSms({ phoneNumber, code, language, method }) {
  if (WHATSAPP_CLOUD_CONFIGURED) {
    try {
      await sendViaWhatsAppCloud({ phoneNumber, code, language });
      return true;
    } catch (whatsappError) {
      console.warn(
        `WhatsApp OTP delivery failed for ${phoneNumber}, falling back to ${provider}:`,
        whatsappError?.message || whatsappError
      );
    }
  }

  return sendViaFallbackProvider({ phoneNumber, code, language, method });
}
