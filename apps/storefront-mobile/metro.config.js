/* eslint-env node */
// Metro config for the public storefront app. Mirrors apps/mobile so the
// pnpm monorepo + NativeWind v5 + react-native-css setup resolves identically.
const { getDefaultConfig } = require("expo/metro-config")
const { withNativeWind } = require("nativewind/metro")
const path = require("node:path")

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, "../..")

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot)

config.transformer.getTransformOptions = async () => ({
  transform: {
    inlineRequires: true,
  },
})

// Monorepo (pnpm) resolution — watch the repo root + resolve from both
// node_modules trees, with hierarchical lookup ON (pnpm isolated store).
config.watchFolders = [monorepoRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
]
config.resolver.unstable_enableSymlinks = true
config.resolver.disableHierarchicalLookup = false
config.resolver.unstable_conditionNames = ["require", "default", "browser"]
config.resolver.sourceExts.push("cjs")

module.exports = withNativeWind(config)
