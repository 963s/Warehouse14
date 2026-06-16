// Custom entry point.
//
// 1) react-native-gesture-handler must be imported first (RN requirement).
// 2) React Native has no Web Crypto by default, but @warehouse14/api-client
//    uses crypto.getRandomValues() for its uuidv7 request ids — polyfill it
//    before any module touches the API client.
// Both run ahead of the expo-router entry (which registers the root component
// as a side effect).
import "react-native-gesture-handler"
import "react-native-get-random-values"
import "expo-router/entry"
