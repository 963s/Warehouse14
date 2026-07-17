/**
 * The API base URL, resolved the same way as main.tsx (env override, else the
 * production host). Exposed as a constant so screens that must build an absolute
 * server URL themselves — e.g. the Google sign-in `/start` link opened in the
 * system browser — don't have to reach into `import.meta.env` inline.
 */

const env = (import.meta as unknown as { env: { VITE_API_BASE_URL?: string } }).env;

export const API_BASE_URL = env.VITE_API_BASE_URL ?? 'https://api.warehouse14.de';
