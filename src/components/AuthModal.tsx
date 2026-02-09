import { useState } from 'react';
import { X } from 'lucide-react';
import { apiBaseUrl } from '../utils/supabase/info';

interface AuthModalProps {
  onClose: () => void;
  onSuccess: (...args: [any, string]) => void;
  language: 'en' | 'ar';
}

export function AuthModal({ onClose, onSuccess, language }: AuthModalProps) {
  const [step, setStep] = useState<'phone' | 'otp' | 'name'>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [demoOtp, setDemoOtp] = useState('');
  const [tempSessionToken, setTempSessionToken] = useState('');
  const [tempUser, setTempUser] = useState<any>(null);

  const content = {
    en: {
      title: 'Sign In',
      userTab: 'Phone',
      phoneLabel: 'Phone Number',
      phonePlaceholder: '5XXXXXXXX',
      sendOtp: 'Send Code',
      otpLabel: 'Verification Code',
      otpPlaceholder: 'Enter 6-digit code',
      verify: 'Verify',
      nameLabel: 'Your Name',
      namePlaceholder: 'Enter your name',
      continue: 'Continue',
      note: 'We will text you a verification code.',
    },
    ar: {
      title: 'تسجيل الدخول',
      userTab: 'هاتف',
      phoneLabel: 'رقم الهاتف',
      phonePlaceholder: '5XXXXXXXX',
      sendOtp: 'إرسال الرمز',
      otpLabel: 'رمز التحقق',
      otpPlaceholder: 'أدخل رمز من 6 أرقام',
      verify: 'تحقق',
      nameLabel: 'اسمك',
      namePlaceholder: 'أدخل اسمك',
      continue: 'متابعة',
      note: 'سنرسل لك رمز التحقق عبر رسالة نصية.',
    },
  };

  const text = content[language];
  const isRTL = language === 'ar';

  const normalizeLocalPhone = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('05')) return digits;
    if (digits.startsWith('5')) return `0${digits}`;
    return digits;
  };

  const handleSendOtp = async () => {
    if (!phoneNumber) {
      setError('Phone number is required');
      return;
    }

    const normalized = normalizeLocalPhone(phoneNumber);
    if (!/^05\d{8}$/.test(normalized)) {
      setError('Enter a valid KSA number (05xxxxxxxx or 5xxxxxxxx)');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${apiBaseUrl}/auth/send-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber: normalized, language }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send OTP');
      }

      if (data.otp) setDemoOtp(String(data.otp));

      setStep('otp');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp) {
      setError('Verification code is required');
      return;
    }

    const normalized = normalizeLocalPhone(phoneNumber);
    if (!/^05\d{8}$/.test(normalized)) {
      setError('Enter a valid KSA number (05xxxxxxxx or 5xxxxxxxx)');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${apiBaseUrl}/auth/verify-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber: normalized, otp }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify OTP');
      }

      // If user name is 'Guest', show name input
      if (data.user.name === 'Guest') {
        setStep('name');
        setTempSessionToken(data.sessionToken);
        setTempUser(data.user);
      } else {
        // User already has a name, sign them in directly
        onSuccess(data.user, data.sessionToken);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteName = async () => {
    if (!name) {
      setError('Name is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Simply update the user object with the name and proceed
      // The backend will be updated on next interaction
      const updatedUser = {
        ...tempUser,
        name: name.trim(),
      };

      // Store updated user in session map via backend
      const response = await fetch(`${apiBaseUrl}/auth/complete-profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tempSessionToken}`,
        },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (response.ok) {
        const data = await response.json();
        onSuccess(data.user, tempSessionToken);
      } else {
        // Fallback: if backend fails, still proceed with local update
        console.warn('Backend update failed, proceeding with local update');
        onSuccess(updatedUser, tempSessionToken);
      }
    } catch (err: any) {
      console.error('Complete profile error:', err);
      // Even if there's an error, proceed with the local user update
      const updatedUser = {
        ...tempUser,
        name: name.trim(),
      };
      onSuccess(updatedUser, tempSessionToken);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-[var(--matte-black)] bg-opacity-90 z-50 flex items-center justify-center p-6"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="bg-[var(--crisp-white)] max-w-md w-full p-8 relative">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
        >
          <X size={24} />
        </button>

        <h2 className="text-2xl mb-6 text-[var(--matte-black)]">{text.title}</h2>

        {step === 'phone' && (
          <div>
            <label className="block text-sm mb-2 text-[var(--matte-black)]">
              {text.phoneLabel}
            </label>
            <div className="flex items-center gap-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)] px-4 py-3 mb-4 focus-within:border-[var(--espresso-brown)]">
              <span className="text-[var(--matte-black)] text-sm" dir="ltr">
                +966
              </span>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setPhoneNumber(digits);
                }}
                placeholder="5XXXXXXXX"
                dir="ltr"
                inputMode="numeric"
                autoComplete="tel"
                className="w-full bg-transparent text-[var(--matte-black)] focus:outline-none"
                disabled={loading}
              />
            </div>

            <div className="text-xs text-[var(--matte-black)] opacity-60 mb-4 p-3 bg-[var(--cool-gray)]">
              {text.note}
            </div>

            {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

            <button
              onClick={handleSendOtp}
              disabled={loading}
              className="w-full py-4 px-6 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors disabled:opacity-50"
            >
              {loading ? '...' : text.sendOtp}
            </button>
          </div>
        )}

        {step === 'otp' && (
          <div>
            <label className="block text-sm mb-2 text-[var(--matte-black)]">{text.otpLabel}</label>
            <input
              type="text"
              value={otp}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                setOtp(digits);
              }}
              placeholder={text.otpPlaceholder}
              maxLength={6}
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              name="one-time-code"
              pattern="[0-9]*"
              autoCorrect="off"
              autoCapitalize="off"
              enterKeyHint="done"
              className="w-full p-4 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)] text-[var(--matte-black)] mb-4 focus:outline-none focus:border-[var(--espresso-brown)]"
              disabled={loading}
            />

            {demoOtp && (
              <div className="text-sm mb-4 p-3 bg-[var(--cool-gray)] text-[var(--matte-black)]">
                {language === 'ar' ? 'رمز التجربة:' : 'Dev code:'}{' '}
                <span className="font-bold">{demoOtp}</span>
              </div>
            )}

            {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

            <button
              onClick={handleVerifyOtp}
              disabled={loading}
              className="w-full py-4 px-6 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors disabled:opacity-50"
            >
              {loading ? '...' : text.verify}
            </button>
          </div>
        )}

        {step === 'name' && (
          <div>
            <label className="block text-sm mb-2 text-[var(--matte-black)]">{text.nameLabel}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={text.namePlaceholder}
              className="w-full p-4 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)] text-[var(--matte-black)] mb-4 focus:outline-none focus:border-[var(--espresso-brown)]"
              disabled={loading}
            />

            {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

            <button
              onClick={handleCompleteName}
              disabled={loading}
              className="w-full py-4 px-6 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors disabled:opacity-50"
            >
              {loading ? '...' : text.continue}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
