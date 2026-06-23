const { withDangerousMod, withGradleProperties } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Android build-toolchain fixes for the React Native 0.83 / Expo SDK 55
 * prebuild output. Both fixes target the gitignored, prebuild-generated
 * `android/` folder, so they re-apply on every `expo prebuild` (including
 * `--clean`).
 *
 * 1) Pin the Gradle wrapper to 8.14.3.
 *    The bare prebuild template stamps a Gradle 9.x wrapper. The React Native
 *    gradle plugin (included via includeBuild) applies
 *    `org.gradle.toolchains.foojay-resolver-convention` 0.5.0, whose bytecode
 *    references `JvmVendorSpec.IBM_SEMERU` — a field removed in Gradle 9. That
 *    makes settings evaluation fail immediately with
 *    `NoSuchFieldError: ... IBM_SEMERU`. AGP for RN 0.83 is pinned to 8.12,
 *    which only needs Gradle 8.13+, so 8.14.3 fixes the build without losing
 *    any required Gradle 9 API. expo-build-properties (SDK 55) has no
 *    gradleVersion option, hence the dangerous mod on the wrapper file.
 *
 * 2) Raise the Gradle daemon JVM memory.
 *    The default `org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m` is
 *    too small for this app: a release build with R8 + Hermes + many native
 *    modules exhausts Metaspace and the daemon dies with
 *    `java.lang.OutOfMemoryError: Metaspace` during `minifyReleaseWithR8` /
 *    `compileReleaseArtProfile`. We bump heap and metaspace generously.
 */
const GRADLE_VERSION = "8.14.3";
const JVM_ARGS = "-Xmx6144m -XX:MaxMetaspaceSize=2048m";

const withGradleWrapperVersion = (config, { version = GRADLE_VERSION } = {}) => {
  // Fix 2: JVM memory via gradle.properties (managed key, survives prebuild).
  config = withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const existing = props.find(
      (item) => item.type === "property" && item.key === "org.gradle.jvmargs",
    );
    if (existing) {
      existing.value = JVM_ARGS;
    } else {
      props.push({ type: "property", key: "org.gradle.jvmargs", value: JVM_ARGS });
    }
    return cfg;
  });

  // Fix 1: pin the Gradle wrapper distributionUrl.
  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      const propsPath = path.join(
        cfg.modRequest.platformProjectRoot,
        "gradle",
        "wrapper",
        "gradle-wrapper.properties",
      );

      if (fs.existsSync(propsPath)) {
        const contents = fs.readFileSync(propsPath, "utf8");
        const next = contents.replace(
          /distributionUrl=.*/,
          `distributionUrl=https\\://services.gradle.org/distributions/gradle-${version}-bin.zip`,
        );
        if (next !== contents) {
          fs.writeFileSync(propsPath, next);
        }
      }

      return cfg;
    },
  ]);

  return config;
};

module.exports = withGradleWrapperVersion;
