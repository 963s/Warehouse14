/**
 * Guarantee android.permission.RECORD_AUDIO in the built manifest.
 *
 * Verified trap (2026-07-19, v1.0.7): the permission was listed in
 * app.json `android.permissions` AND implied by the WebRTC config plugin,
 * yet the built APK's manifest carried MODIFY_AUDIO_SETTINGS but NOT
 * RECORD_AUDIO — leaving the Vierzehn voice agent with a dead microphone.
 * This tiny local plugin injects it deterministically at prebuild, exactly
 * like the sibling withGradleWrapperVersion pattern.
 */
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

module.exports = function withRecordAudio(config) {
  return withAndroidManifest(config, (c) => {
    AndroidConfig.Permissions.addPermission(c.modResults, 'android.permission.RECORD_AUDIO');
    return c;
  });
};
