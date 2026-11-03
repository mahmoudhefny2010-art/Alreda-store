const { z } = require('zod');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(666),
  GOOGLE_CLIENT_ID: z.string().trim().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CALLBACK_URL: z.string().trim().default(''),
  SESSION_SECRET: z.preprocess(value => value === '' ? undefined : value, z.string().min(32).optional()),
}).superRefine((value, ctx) => {
  if (Boolean(value.GOOGLE_CLIENT_ID) !== Boolean(value.GOOGLE_CLIENT_SECRET)) ctx.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_SECRET'], message: 'Both Google OAuth credentials are required' });
  if (value.GOOGLE_CALLBACK_URL) {
    try {
      const callback = new URL(value.GOOGLE_CALLBACK_URL);
      if (!['http:', 'https:'].includes(callback.protocol) || callback.username || callback.password || callback.pathname !== '/auth/google/callback') throw new Error();
      if (value.NODE_ENV === 'production' && callback.protocol !== 'https:') throw new Error();
    } catch { ctx.addIssue({ code: 'custom', path: ['GOOGLE_CALLBACK_URL'], message: 'Must be a valid HTTPS production callback URL' }); }
  }
  if (value.NODE_ENV === 'production' && value.GOOGLE_CLIENT_ID && !value.SESSION_SECRET) ctx.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'Required in production' });
});

function readAuthConfig(source = process.env) {
  const result = configSchema.safeParse(source);
  if (!result.success) throw new Error(`Invalid authentication configuration: ${[...new Set(result.error.issues.map(issue => issue.path.join('.')))].join(', ')}`);
  const value = result.data;
  const callbackUrl = value.GOOGLE_CALLBACK_URL || `http://127.0.0.1:${value.PORT}/auth/google/callback`;
  const secret = value.SESSION_SECRET || (value.NODE_ENV === 'test' ? 'test-only-session-secret-not-for-real-deployments' : '');
  return Object.freeze({ enabled: Boolean(value.GOOGLE_CLIENT_ID && value.GOOGLE_CLIENT_SECRET && secret), clientId: value.GOOGLE_CLIENT_ID,
    clientSecret: value.GOOGLE_CLIENT_SECRET, callbackUrl, sessionSecret: secret, secureCookie: value.NODE_ENV === 'production' });
}

module.exports = { readAuthConfig };
