// No-op setup for the German text DEV guard.
//
// The guard exercises a pure mapping module; it deliberately does NOT load the
// shared `test/setup.ts` (React-Native + i18n mocks the guard does not need and
// which reference stale Ignite scaffolding). Keeping this empty is intentional.
export {}
