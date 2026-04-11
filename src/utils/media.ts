import { apiBaseUrl } from './api';

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
const isAbsoluteHttpUrl = (value: string) => /^https?:\/\//i.test(value);

export const resolveImageUrl = (input?: string | null) => {
  const raw = (input || '').trim();
  if (!raw) return '';
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;

  try {
    const base = getWindowOrigin() || 'http://localhost';
    const url = new URL(raw, base);
    if (url.pathname.startsWith('/uploads/')) {
      if (!isAbsoluteHttpUrl(raw) && apiOrigin && url.origin !== apiOrigin) {
        return `${apiOrigin}${url.pathname}${url.search}`;
      }
      if (url.protocol === 'http:' && base.startsWith('https://')) {
        url.protocol = 'https:';
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
