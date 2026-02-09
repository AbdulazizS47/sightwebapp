export const enableHealthcheck = import.meta.env.VITE_ENABLE_HEALTHCHECK === 'true';

// API backend configuration
const rawApiBase = (import.meta.env.VITE_API_BASE_URL || '/api').trim();
// Normalize to prevent accidental double "/api/api" and remove trailing slash
const normalizedApiBase = rawApiBase.replace(/\/api\/api(\/|$)/, '/api$1').replace(/\/+$/, '');
export const apiBaseUrl = normalizedApiBase;
