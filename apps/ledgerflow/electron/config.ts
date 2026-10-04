import { existsSync, readFileSync } from 'node:fs'
import { googleEndpoints, type GoogleEndpoints } from './oauth.ts'

export type DesktopConfig = {
  googleClientId: string
  googleClientSecret: string
  licenseServerUrl: string
  licensePublicKey: string
  updateFeedUrl: string
  /** Trial builds: last day (YYYY-MM-DD) the app runs without a licence. Ignored once a licence service is configured. */
  trialUntil: string
  endpoints: GoogleEndpoints
}

/**
 * Settings shipped with the installer in desktop.config.json. Nothing here is confidential: an OAuth desktop
 * client ID, public URLs and the public half of the licence key. Service-account keys must never be added.
 */
export function loadConfig(file: string, env: NodeJS.ProcessEnv = process.env): DesktopConfig {
  const stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Partial<DesktopConfig> : {}
  const value = (key: keyof Omit<DesktopConfig, 'endpoints'>, variable: string) => (env[variable] ?? stored[key] ?? '').trim()
  return {
    googleClientId: value('googleClientId', 'AICOM_GOOGLE_CLIENT_ID'),
    googleClientSecret: value('googleClientSecret', 'AICOM_GOOGLE_CLIENT_SECRET'),
    licenseServerUrl: value('licenseServerUrl', 'AICOM_LICENSE_SERVER_URL').replace(/\/+$/, ''),
    licensePublicKey: value('licensePublicKey', 'AICOM_LICENSE_PUBLIC_KEY'),
    updateFeedUrl: value('updateFeedUrl', 'AICOM_UPDATE_FEED_URL'),
    trialUntil: value('trialUntil', 'AICOM_TRIAL_UNTIL'),
    // Overridable so automated tests can run against a local stand-in for Google.
    endpoints: env.AICOM_GOOGLE_ENDPOINTS ? { ...googleEndpoints, ...JSON.parse(env.AICOM_GOOGLE_ENDPOINTS) as Partial<GoogleEndpoints> } : googleEndpoints,
  }
}
