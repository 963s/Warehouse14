// Required by NativeWind v5 / Tailwind v4 for the web (react-native-web) build.
// Native (Metro) styling works without it, but `expo export -p web` needs the
// PostCSS pipeline to run Tailwind. Missing this = unstyled web output.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
}
