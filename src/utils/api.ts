export const enableHealthcheck = import.meta.env.VITE_ENABLE_HEALTHCHECK === 'true';
export const allowSeedMenuTools =
  import.meta.env.VITE_ALLOW_SEED_MENU_TOOLS === 'true' ||
  import.meta.env.VITE_ALLOW_DEMO_MENU_TOOLS === 'true';

const rawApiBase = (import.meta.env.VITE_API_BASE_URL || '/api').trim();
const normalizedApiBase = rawApiBase.replace(/\/api\/api(\/|$)/, '/api$1').replace(/\/+$/, '');

export const apiBaseUrl = normalizedApiBase;

function normalizeApiPath(path: string) {
  const value = String(path || '').trim();
  if (!value) return '';
  return value.startsWith('/') ? value : `/${value}`;
}

function buildApiUrl(base: string, path: string) {
  const normalizedBase = String(base || '').trim().replace(/\/+$/, '');
  const normalizedPath = normalizeApiPath(path);
  return `${normalizedBase}${normalizedPath}`;
}

export function getApiRequestUrls(path: string) {
  const urls = new Set<string>();
  const addBase = (base: string | null | undefined) => {
    const normalizedBase = String(base || '').trim().replace(/\/+$/, '');
    if (!normalizedBase) return;
    urls.add(buildApiUrl(normalizedBase, path));
  };

  addBase(apiBaseUrl);

  if (typeof window !== 'undefined') {
    addBase(`${window.location.origin}/api`);

    const { hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      addBase('http://127.0.0.1:4000/api');
      addBase('http://localhost:4000/api');
      addBase('http://127.0.0.1:3000/api');
      addBase('http://localhost:3000/api');
    }
  }

  return Array.from(urls);
}
