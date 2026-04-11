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

export async function sendOtpSms({ phoneNumber, code, language, method }) {
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
