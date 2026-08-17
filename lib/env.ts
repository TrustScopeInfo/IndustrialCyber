/**
 * Environment variables, read at request time rather than at module load, so a
 * missing value fails with a clear message instead of breaking the build.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Locally it belongs in .env.local, ` +
        `on Vercel in Settings, Environment Variables.`,
    )
  }
  return value
}

export const SUPABASE_URL = () => requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
export const SUPABASE_PUBLISHABLE_KEY = () => requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
export const SUPABASE_SECRET_KEY = () => requiredEnv('SUPABASE_SECRET_KEY')
