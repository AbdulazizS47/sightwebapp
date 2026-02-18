type OtpCredentialLike = {
  code?: string;
};

type CredentialContainerLike = {
  get?: (options: {
    otp: { transport: string[] };
    signal?: AbortSignal;
  }) => Promise<OtpCredentialLike | null>;
};

type NavigatorWithCredentials = Navigator & {
  credentials?: CredentialContainerLike;
};

export function supportsWebOtp() {
  if (typeof window === 'undefined') return false;
  const nav = navigator as NavigatorWithCredentials;
  return Boolean('OTPCredential' in window && nav.credentials?.get);
}

export async function readOtpFromSms(signal?: AbortSignal): Promise<string | null> {
  if (!supportsWebOtp()) return null;
  try {
    const nav = navigator as NavigatorWithCredentials;
    const cred = await nav.credentials?.get?.({
      otp: { transport: ['sms'] },
      signal,
    });
    const code = String(cred?.code || '').replace(/\D/g, '').slice(0, 6);
    return code || null;
  } catch {
    return null;
  }
}
