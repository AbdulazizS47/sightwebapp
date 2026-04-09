export const enableHealthcheck = import.meta.env.VITE_ENABLE_HEALTHCHECK === 'true';
export const allowSeedMenuTools =
  import.meta.env.VITE_ALLOW_SEED_MENU_TOOLS === 'true' ||
  import.meta.env.VITE_ALLOW_DEMO_MENU_TOOLS === 'true';

const rawApiBase = (import.meta.env.VITE_API_BASE_URL || '/api').trim();
const normalizedApiBase = rawApiBase.replace(/\/api\/api(\/|$)/, '/api$1').replace(/\/+$/, '');

export const apiBaseUrl = normalizedApiBase;
