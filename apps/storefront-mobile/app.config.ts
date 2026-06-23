import type { ExpoConfig, ConfigContext } from "@expo/config"

/**
 * Dynamic Expo config for the public storefront app.
 *
 * The static config lives in app.json; this file injects the public API base
 * URL at build time so the bundle always points at the live catalog
 * (https://api.warehouse14.de). The Gradle-wrapper plugin (pinned to 8.14.3
 * with raised JVM heap) is referenced from app.json and defined in ./plugins.
 */
import "tsx/cjs"

const DEFAULT_API_BASE_URL = "https://api.warehouse14.de"

module.exports = ({ config }: ConfigContext): Partial<ExpoConfig> => {
  const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL
  return {
    ...config,
    extra: {
      ...(config.extra ?? {}),
      apiUrl,
    },
  }
}
