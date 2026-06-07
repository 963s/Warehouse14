# Companion LAN Hub — Architecture

> The mother POS becomes a **local server** on the shop's LAN. Companion
> devices — a second-cashier tablet, a customer-facing iPad, a stock-room
> phone — connect to it directly over Wi-Fi and ride on the mother's
> authenticated cloud session. No companion ever holds its own cloud
> credentials.

This document describes the **mother-as-LAN-hub** model, the foundation that
ships now, and the phases that build on it. It is the architecture-of-record
for the companion subsystem; the Rust implementation lives in
`apps/tauri-pos/src-tauri/src/commands/companion.rs`.

---

## 1. Why mother-as-server

The shop has exactly one fully-provisioned terminal: the **mother** POS (the
Tauri desktop app, mTLS device cert, the authenticated cloud session). Adding a
second cashier or a customer display should NOT mean provisioning another full
device with its own cert, login, and session — that multiplies the GwG/GoBD
attack surface and the go-live hardening burden.

Instead the mother runs a small embedded HTTP server bound to the LAN. Other
devices are **thin companions**: a browser pointed at the mother. They have no
cloud credentials of their own. Everything they do reaches the cloud **through**
the mother, which injects its own session. One provisioned device, many faces.

```
                         ┌─────────────────────────────┐
                         │      Anthropic / api.cloud   │
                         │   (Authorization: Bearer …)  │
                         └──────────────▲──────────────┘
                                        │  mother's session only
                                        │
                ┌───────────────────────┴───────────────────────┐
                │                MOTHER POS (Tauri)              │
                │   • authenticated cloud session (Bearer)       │
                │   • embedded axum server  0.0.0.0:8714         │
                │   • cloud proxy (injects Bearer)  [phase 2]    │
                │   • realtime hub (WebSocket)      [phase 3]    │
                └───▲───────────────▲───────────────▲────────────┘
           LAN Wi-Fi│               │               │
            ┌────────┴───┐  ┌────────┴────┐  ┌───────┴────────┐
            │ 2nd Cashier │  │  Customer   │  │   Warehouse    │
            │  (tablet)   │  │  Display    │  │   (phone)      │
            │             │  │  (iPad)     │  │                │
            └─────────────┘  └─────────────┘  └────────────────┘
```

---

## 2. The embedded axum server

- **Crate:** [`axum`] `0.7`, served on the existing Tauri Tokio runtime
  (`rt-multi-thread` + `net` are already enabled). It reuses the same `hyper`
  the rest of the app already pulls in.
- **Bind:** `0.0.0.0:8714` so it is reachable from every device on the LAN.
  `8714` is in the IANA dynamic range and unlikely to collide; if it is already
  bound we fall back to an **OS-assigned ephemeral port** and report the real
  port back to the UI.
- **LAN IP:** resolved with the [`local-ip-address`] crate. The pairing URL and
  QR encode the real LAN IPv4 (e.g. `http://192.168.1.20:8714`); if no LAN
  address is available (link-down) we degrade to `127.0.0.1`.
- **Lifecycle:** the serve task is spawned with `tokio::spawn` and held in
  Tauri-managed state (`CompanionState`) together with a `oneshot` shutdown
  sender. `companion_stop` fires the oneshot → axum drains in-flight requests
  via `with_graceful_shutdown`. `companion_start` is **idempotent**: a second
  call returns the already-running snapshot (double-checked under the state lock
  to close the start/start race).
- **Fail-safe:** a bind failure logs and returns the "stopped" snapshot. The POS
  keeps working; companions simply stay unavailable. Nothing here can crash the
  webview.

### Routes shipped now

| Method · Path | Purpose |
|---|---|
| `GET /`        | Minimal German landing page — *"Warehouse14 Begleiter — Verbindung mit der Hauptkasse. Die Kopplung folgt in Kürze."* So scanning the pairing QR from a phone/iPad actually loads a page served by the mother. |
| `GET /health`  | Liveness probe → `"ok"`. |

---

## 3. IPC contract (shared with the React layer)

Three Tauri v2 commands, called from JS via
`invoke('companion_start' | 'companion_stop' | 'companion_status')`:

```
companion_start() -> CompanionInfo   // idempotent; binds on first call
companion_stop()  -> ()              // idempotent; no-op when stopped
companion_status() -> CompanionInfo  // current snapshot
```

`CompanionInfo` (serde `camelCase`):

```ts
interface CompanionInfo {
  running: boolean;
  url: string;        // "http://192.168.1.20:8714"  ("" when stopped)
  port: number;       // bound TCP port               (0  when stopped)
  pairingCode: string;// fresh 6-digit numeric code    ("" when stopped)
  qrSvg: string;      // SVG QR encoding `url`         ("" when stopped)
}
```

> Implementation note: the Rust commands return `Result<CompanionInfo, ()>`
> because async Tauri commands that borrow `State` must return `Result`. Tauri
> serializes the `Ok` value transparently, so on the JS side
> `await invoke('companion_start')` resolves directly to a `CompanionInfo`.

### Pairing code & QR

- The **6-digit pairing code** is generated fresh on every `companion_start`
  with the non-cryptographic `fastrand` (already a dependency). It is **display
  only** in this foundation — nothing authenticates against it yet. When the
  pairing handshake lands (phase 2) this MUST move to a CSPRNG.
- The **QR** encodes the LAN URL and is rendered to an SVG string with the
  `qrcode` crate (`qrcode::render::svg::Color`), black-on-white, ≥220×220. The
  UI shows the QR + code so a companion can scan and connect.

---

## 4. Pairing handshake (phase 2 — planned)

1. Operator opens the companion panel on the mother → calls `companion_start` →
   sees the QR + 6-digit code.
2. Companion device scans the QR → loads `GET /` from the mother, then a pairing
   form (or auto-advance) → POSTs the 6-digit code to `POST /pair`.
3. The mother verifies the code (constant-time compare, single-use, short TTL,
   rate-limited), assigns a **role** (see §6), and issues the companion a
   short-lived, role-scoped **companion token** (a server-minted opaque token,
   NOT the cloud Bearer — companions never see that).
4. The companion stores its companion token and uses it on every subsequent
   request to the mother. A device registry on the mother tracks paired
   companions (id, role, last-seen) so the operator can revoke any of them.

The code rotates on each `companion_start`; revoking a companion drops it from
the registry and invalidates its companion token.

---

## 5. Authenticated cloud proxy (phase 2 — planned)

Companions have **no cloud credentials**. The mother exposes a reverse proxy:

```
companion ──(companion token)──▶ mother  /api/proxy/*  ──(Bearer)──▶ api.warehouse14.de
```

- The mother validates the companion token + role, then forwards the request to
  the cloud, **injecting its own** `Authorization: Bearer <session>` header.
- The Bearer value is the mother's session token from
  `apps/tauri-pos/src/lib/session-token.ts` (mirrors the `sessions.token`
  cookie). The cloud already accepts `Authorization: Bearer` on every route —
  see that file's header comment and the api-client interceptor — so no
  server-side change is required to accept proxied calls.
- The proxy is **allow-listed and role-scoped**: a Customer-Display companion
  can read the live cart but cannot finalize a sale; a Second-Cashier can ring
  up but inherits the mother's step-up rules (the cloud still enforces
  `STEP_UP_REQUIRED`, which the proxy surfaces back to the companion).

This keeps every cloud-side audit/GwG/GoBD control intact: from the cloud's
point of view, all traffic is the mother's authenticated session, regardless of
which physical face initiated it.

---

## 6. Role model

| Role | Device | Capabilities (phase 2+) |
|---|---|---|
| **Warehouse**        | stock-room phone/tablet | Read inventory, scan/look-up SKUs, adjust bin/location, intake photos. No payments. |
| **Second-Cashier**   | a second till tablet    | Full Kasse ring-up through the proxy; subject to the mother's step-up + KYC enforcement. |
| **Customer-Display** | customer-facing iPad    | Read-only live cart + totals + receipt preview; driven by the realtime feed. No mutations. |

Roles are assigned at pairing time and encoded into the companion token; the
proxy allow-list is keyed by role.

---

## 7. Realtime WebSocket (phase 3 — planned, for the Customer Display)

The Customer-Display must reflect the mother's cart **live** as the cashier
scans items. Polling is too laggy and too chatty.

- The mother adds `GET /ws` (an axum WebSocket upgrade). On connect, the
  companion authenticates with its companion token and subscribes by role.
- The mother **broadcasts** cart/total/line-item events to subscribed displays
  (a `tokio::sync::broadcast` channel fed by the cart state). The display
  re-renders on each event — no request/response round-trips.
- The same channel later drives a "payment in progress / thank you" state on the
  customer display, and could push price-check results to a Warehouse device.

---

## 8. What ships now vs. what's next

**Ships now (this foundation):**

- ✅ `companion_start` / `companion_stop` / `companion_status` IPC commands.
- ✅ Embedded axum server on `0.0.0.0:8714` (ephemeral fallback) with
  `GET /` (German landing page) and `GET /health`.
- ✅ Real LAN-IP pairing URL + SVG QR + fresh 6-digit code, returned as
  `CompanionInfo`.
- ✅ Idempotent, fail-safe, graceful-shutdown lifecycle held in Tauri state.

**Next phases (NOT in this foundation):**

- ⏳ **Phase 2** — pairing-code handshake (`POST /pair`), device registry +
  revocation, role assignment, CSPRNG pairing codes, the role-scoped
  authenticated cloud proxy (`/api/proxy/*`) that injects the mother's Bearer.
- ⏳ **Phase 3** — the realtime WebSocket (`GET /ws`) broadcasting cart state to
  the Customer-Display, plus the companion front-ends per role.
- ⏳ **Hardening** — TLS on the LAN hop (or strict same-subnet + CSP), pairing
  rate-limiting, companion-token TTL/rotation, and an operator kill-switch.

[`axum`]: https://docs.rs/axum/0.7
[`local-ip-address`]: https://docs.rs/local-ip-address/0.6
