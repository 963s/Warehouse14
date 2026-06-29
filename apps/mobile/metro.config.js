/* eslint-env node */
// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config")
const { withNativeWind } = require("nativewind/metro")
const path = require("node:path")

// ── Monorepo roots ────────────────────────────────────────────────────────
// apps/mobile is one workspace inside the pnpm-isolated warehouse14 monorepo.
// Metro must watch the repo root (so edits to @warehouse14/* dist are picked
// up) and resolve modules from both this app's node_modules and the root's.
const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, "../..")

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot)

config.transformer.getTransformOptions = async () => ({
  transform: {
    // Inline requires defer loading of large dependencies/components.
    // Read more: https://reactnative.dev/docs/optimizing-javascript-loading
    inlineRequires: true,
  },
})

// ── Monorepo (pnpm) resolution ────────────────────────────────────────────
config.watchFolders = [monorepoRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
]
config.resolver.unstable_enableSymlinks = true
// NOTE: the monorepo blueprint suggested disableHierarchicalLookup=true, but
// under pnpm's isolated store that BREAKS transitive resolution — packages keep
// their own deps nested in .pnpm/<pkg>/node_modules rather than hoisted, so
// Metro must be allowed to walk up the symlinked tree to find them (e.g.
// gesture-handler -> hoist-non-react-statics). Keep hierarchical lookup ON.
config.resolver.disableHierarchicalLookup = false

// Temporary fix for apisauce/axios resolving the wrong condition under Metro.
// See https://github.com/infinitered/apisauce/issues/331
config.resolver.unstable_conditionNames = ["require", "default", "browser"]

// Support libraries (e.g. Firebase) that ship `.cjs`.
config.resolver.sourceExts.push("cjs")

// ── Numeric module IDs (production hygiene) ────────────────────────────────
// Metro defaults to using the module's full request URL (e.g.
// `http://localhost:8081/path/to/file.bundle?platform=ios`) as its module
// identifier. When Hermes compiles the bundle, those URL strings land in the
// bytecode string table — so a production .ipa greps positive for
// `localhost:8081` even though nothing fetches it. Replacing the ID factory
// with a stable numeric scheme keeps the URLs out of the bytecode entirely.
// (IDs only need to be unique + stable within a single bundle build.)
const moduleIdCache = new Map()
let moduleIdCounter = 0
config.serializer.createModuleIdFactory = () => {
  return (path) => {
    if (!moduleIdCache.has(path)) {
      moduleIdCache.set(path, moduleIdCounter++)
    }
    return moduleIdCache.get(path)
  }
}

// ── NativeWind v5 ───────────────────────────────────────────────────────────
// Wrap the FINAL config so all monorepo settings above are preserved (the
// wrapper mutates + returns the same object). NativeWind v5's withNativeWind
// takes NO second argument — the v4 `{ input: './global.css' }` option was
// removed; the CSS entry is wired by `import "./global.css"` in the root layout.
module.exports = withNativeWind(config)
