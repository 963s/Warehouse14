/**
 * Shopper session + cart store.
 *
 * Holds the minimal sign-in state (whether a shopper session exists) plus the
 * live cart. The real auth credential is the `warehouse14.shopper_session`
 * cookie, carried by the API client (credentials:'include'); we only track the
 * boolean + the shopper's email locally so the UI can show Anmelden / Abmelden.
 *
 * Persists just the signed-in flag + email in AsyncStorage so a relaunch keeps
 * the header state in sync with the still-valid cookie (30-day rolling TTL).
 */

import AsyncStorage from "@react-native-async-storage/async-storage"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { auth, cart as cartApi } from "../lib/api"
import type { CartView, SignInBody, SignUpBody } from "../lib/types"

const STORAGE_KEY = "w14.shopper.v1"

interface PersistedShopper {
  signedIn: boolean
  email: string | null
}

interface ShopperContextValue {
  ready: boolean
  signedIn: boolean
  email: string | null
  cart: CartView | null
  cartLoading: boolean
  refreshCart: () => Promise<void>
  signIn: (body: SignInBody) => Promise<void>
  signUp: (body: SignUpBody) => Promise<void>
  signOut: () => Promise<void>
  addToCart: (productId: string) => Promise<void>
  removeFromCart: (itemId: string) => Promise<void>
}

const ShopperContext = createContext<ShopperContextValue | null>(null)

export function ShopperProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [cartState, setCartState] = useState<CartView | null>(null)
  const [cartLoading, setCartLoading] = useState(false)

  // Restore persisted sign-in flag on launch.
  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return
        if (raw) {
          const parsed = JSON.parse(raw) as PersistedShopper
          setSignedIn(parsed.signedIn)
          setEmail(parsed.email)
        }
      })
      .catch(() => {})
      .finally(() => setReady(true))
    return () => {
      cancelled = true
    }
  }, [])

  const persist = useCallback((next: PersistedShopper) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
  }, [])

  const refreshCart = useCallback(async () => {
    if (!signedIn) {
      setCartState(null)
      return
    }
    setCartLoading(true)
    try {
      const c = await cartApi.get()
      setCartState(c)
    } catch {
      // A 401 here means the cookie expired; clear the local flag so the UI
      // prompts for sign-in again. Other errors leave the cart as-is.
      setSignedIn(false)
      setEmail(null)
      setCartState(null)
      persist({ signedIn: false, email: null })
    } finally {
      setCartLoading(false)
    }
  }, [signedIn, persist])

  // When sign-in state changes, refresh the cart.
  useEffect(() => {
    if (ready && signedIn) refreshCart()
    else if (ready) setCartState(null)
  }, [ready, signedIn, refreshCart])

  const signIn = useCallback(
    async (body: SignInBody) => {
      await auth.signIn(body)
      setSignedIn(true)
      setEmail(body.email)
      persist({ signedIn: true, email: body.email })
    },
    [persist],
  )

  const signUp = useCallback(
    async (body: SignUpBody) => {
      await auth.signUp(body)
      setSignedIn(true)
      setEmail(body.email)
      persist({ signedIn: true, email: body.email })
    },
    [persist],
  )

  const signOut = useCallback(async () => {
    try {
      await auth.signOut()
    } catch {
      // ignore, the local state clears regardless
    }
    setSignedIn(false)
    setEmail(null)
    setCartState(null)
    persist({ signedIn: false, email: null })
  }, [persist])

  const addToCart = useCallback(
    async (productId: string) => {
      const c = await cartApi.addItem(productId)
      setCartState(c)
    },
    [],
  )

  const removeFromCart = useCallback(async (itemId: string) => {
    const c = await cartApi.removeItem(itemId)
    setCartState(c)
  }, [])

  const value = useMemo<ShopperContextValue>(
    () => ({
      ready,
      signedIn,
      email,
      cart: cartState,
      cartLoading,
      refreshCart,
      signIn,
      signUp,
      signOut,
      addToCart,
      removeFromCart,
    }),
    [
      ready,
      signedIn,
      email,
      cartState,
      cartLoading,
      refreshCart,
      signIn,
      signUp,
      signOut,
      addToCart,
      removeFromCart,
    ],
  )

  return <ShopperContext.Provider value={value}>{children}</ShopperContext.Provider>
}

export function useShopper(): ShopperContextValue {
  const ctx = useContext(ShopperContext)
  if (!ctx) throw new Error("useShopper must be used within ShopperProvider")
  return ctx
}

/** Cart line count for the tab badge. */
export function useCartCount(): number {
  const { cart } = useShopper()
  if (!cart) return 0
  return cart.items.reduce((sum, it) => sum + it.quantity, 0)
}
