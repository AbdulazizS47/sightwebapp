import { useEffect, useRef, useState } from 'react';
import { apiBaseUrl } from '../utils/supabase/info';
import { readOtpFromSms } from '../utils/otpAutofill';

interface AdminLoginPageProps {
  onBack: () => void;
  onSuccess: (...args: [any, string]) => void;
  language: 'en' | 'ar';
}

export function AdminLoginPage({ onBack, onSuccess, language }: AdminLoginPageProps) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [demoOtp, setDemoOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const otpInputRef = useRef<HTMLInputElement | null>(null);

  const content = {
    en: {
      title: 'Admin Sign In',
      back: 'Back',
      phoneLabel: 'Admin Phone Number',
      phonePlaceholder: '+966 5X XXX XXXX',
      sendOtp: 'Send Code',
      otpLabel: 'Verification Code',
      otpPlaceholder: 'Enter 6-digit code',
      verify: 'Verify',
      note: 'Demo Mode: Any phone can receive a code. Admin role applies only to the configured admin phone.',
    },
    ar: {
      title: 'تسجيل دخول المدير',
      back: 'رجوع',
      phoneLabel: 'رقم هاتف المدير',
      phonePlaceholder: '+966 5X XXX XXXX',
      sendOtp: 'إرسال الرمز',
      otpLabel: 'رمز التحقق',
      otpPlaceholder: 'أدخل رمز من 6 أرقام',
      verify: 'تحقق',
      note: 'وضع التجريب: يمكن لأي رقم استقبال الرمز. تُطبَّق صلاحيات المدير فقط عند استخدام هاتف المدير المهيأ.',
    },
  } as const;

  const text = content[language];
  const isRTL = language === 'ar';

  const handleSendOtp = async () => {
    if (!phoneNumber) {
      setError(language === 'ar' ? 'يرجى إدخال رقم الهاتف' : 'Please enter phone number');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${apiBaseUrl}/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, language }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to send code');
      if (data.otp) setDemoOtp(String(data.otp));
      setStep('otp');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length !== 6) {
      setError(language === 'ar' ? 'أدخل رمزاً صحيحاً' : 'Enter a valid code');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${apiBaseUrl}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, otp }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to verify');
      // Server sets role: 'admin' when ADMIN_PHONE is used
      onSuccess(data.user, data.sessionToken);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (step !== 'otp') return;
    otpInputRef.current?.focus();
    const controller = new AbortController();
    readOtpFromSms(controller.signal).then((code) => {
      if (code) setOtp(code);
    });
    return () => controller.abort();
  }, [step]);

  return (
    <div
      className="min-h-screen bg-[var(--matte-black)] text-[var(--matte-black)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="max-w-xl mx-auto bg-[var(--crisp-white)] p-8 mt-10 shadow-md">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl">{text.title}</h1>
          <button
            onClick={onBack}
            className="text-sm text-[var(--matte-black)] hover:text-[var(--espresso-brown)]"
          >
            {text.back}
          </button>
        </div>

        {/* Phone OTP only (admin via configured phone number) */}
        <div>
          <label className="block text-sm mb-2">{text.phoneLabel}</label>
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder={text.phonePlaceholder}
            dir="ltr"
            className="w-full p-4 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)] mb-4 focus:outline-none focus:border-[var(--espresso-brown)]"
            disabled={loading}
          />
          <div className="text-xs opacity-60 mb-4 p-3 bg-[var(--cool-gray)]">{text.note}</div>
          {step === 'phone' && (
            <button
              onClick={handleSendOtp}
              disabled={loading}
              className="w-full py-4 px-6 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors disabled:opacity-50"
            >
              {loading ? '...' : text.sendOtp}
            </button>
          )}
          {step === 'otp' && (
            <div>
              <label className="block text-sm mb-2">{text.otpLabel}</label>
              <input
                ref={otpInputRef}
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onPaste={(e) => {
                  const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
                  if (digits) {
                    e.preventDefault();
                    setOtp(digits);
                  }
                }}
                placeholder={text.otpPlaceholder}
                maxLength={6}
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                name="otp"
                pattern="[0-9]*"
                autoCorrect="off"
                autoCapitalize="off"
                enterKeyHint="done"
                autoFocus
                className="w-full p-4 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)] mb-4 focus:outline-none focus:border-[var(--espresso-brown)]"
              />

              {demoOtp && (
                <div className="text-sm mb-4 p-3 bg-[var(--cool-gray)]">
                  {language === 'ar' ? 'رمز التجربة:' : 'Dev code:'}{' '}
                  <span className="font-bold">{demoOtp}</span>
                </div>
              )}
              <button
                onClick={handleVerifyOtp}
                disabled={loading}
                className="w-full py-4 px-6 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors disabled:opacity-50"
              >
                {loading ? '...' : text.verify}
              </button>
            </div>
          )}
          {error && <div className="text-red-600 text-sm mt-4">{error}</div>}
        </div>
      </div>
    </div>
  );
}
