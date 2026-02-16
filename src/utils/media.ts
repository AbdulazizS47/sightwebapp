import { apiBaseUrl } from './supabase/info';

const getWindowOrigin = () => {
  if (typeof window === 'undefined') return '';
  return window.location?.origin || '';
};

const getApiOrigin = () => {
  try {
    if (apiBaseUrl.startsWith('http')) {
      return new URL(apiBaseUrl).origin;
    }
    const base = getWindowOrigin() || 'http://localhost';
    return new URL(apiBaseUrl, base).origin;
  } catch {
    return getWindowOrigin();
  }
};

const apiOrigin = getApiOrigin();

export const resolveImageUrl = (input?: string | null) => {
  const raw = (input || '').trim();
  if (!raw) return '';
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;

  try {
    const base = getWindowOrigin() || 'http://localhost';
    const url = new URL(raw, base);
    if (url.pathname.startsWith('/uploads/')) {
      if (apiOrigin && url.origin !== apiOrigin) {
        return `${apiOrigin}${url.pathname}${url.search}`;
      }
    }
    return url.toString();
  } catch {
    if (raw.startsWith('/uploads/') && apiOrigin) {
      return `${apiOrigin}${raw}`;
    }
    return raw;
  }
};
