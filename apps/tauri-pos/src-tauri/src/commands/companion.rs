//! Companion LAN hub — the mother POS as a local server.
//!
//! # The model
//!
//! The mother POS terminal embeds a small [`axum`] HTTP server bound to the
//! LAN. Companion devices on the same network — a second-cashier tablet, an
//! iPad facing the customer, a phone — point their browser at the mother and
//! pair with it. The mother is the only device that holds the authenticated
//! cloud session; companions ride on it through a server-side proxy that
//! injects the mother's `Authorization: Bearer`. See
//! `docs/companion-architecture.md` for the full plan.
//!
//! # What this layer ships
//!
//! - The embedded axum server bound to `0.0.0.0:8714` (ephemeral fallback if
//!   8714 is taken).
//! - `GET /` + `GET /app.*` serve the self-contained companion SPA
//!   (`companion-web/index.html`); `GET /health` is the liveness probe.
//! - `POST /pair` — constant-time code check + role validation + rate limit;
//!   mints an opaque, CSPRNG companion token bound to a role.
//! - `GET /cart` — the latest published cart snapshot for the customer display.
//! - `GET /ws` — realtime customer-display feed (phase 3). A Display companion
//!   authenticates its token via the `Sec-WebSocket-Protocol` handshake header
//!   (NOT the URL — URLs leak into history/logs), then the mother pushes the
//!   cart JSON on connect and on every `companion_publish_cart` via a
//!   `tokio::sync::broadcast` channel. Read-only; same role model as `/cart`.
//! - `ANY /api/proxy/*path` — a strict, role-scoped allow-list reverse proxy
//!   that forwards to `https://api.warehouse14.de/api/...` with the mother's
//!   Bearer injected. Companions never see the cloud credential.
//! - IPC commands: `companion_start` / `companion_stop` / `companion_status`
//!   (lifecycle) plus `companion_set_auth` (store the mother's Bearer) and
//!   `companion_publish_cart` (publish the latest cart snapshot).
//!
//! # Token & code RNG
//!
//! BOTH the 6-digit pairing **code** and the 32-byte companion **token** are
//! drawn from the OS CSPRNG (`getrandom`) — never `fastrand`. The code is
//! single-use (invalidated on the first successful pair), TTL-bounded, and
//! rate-limited on the *real* TCP peer IP. The pairing code is compared with
//! `subtle::ConstantTimeEq` to avoid a timing oracle. If the CSPRNG fails we
//! REFUSE to mint (503) rather than fall back to a weak RNG.
//!
//! # Persistent pairing (frictionless phone link)
//!
//! A paired device used to live only in memory with a 12 h TTL — every app
//! restart and every shift evicted the phone and forced a re-scan of the QR.
//! Pairing is now PERSISTENT:
//!
//! - The registry maps **SHA-256(token) → {role, label, created, last_seen}**.
//!   Only the hash ever touches disk; the plaintext token exists solely on the
//!   companion device.
//! - The map is persisted as JSON under the app data dir
//!   ([`PAIRING_STORE_FILE`], atomic tmp+rename write, 0600 on unix) and loaded
//!   on every hub start.
//! - Expiry is IDLE-based: a device is evicted only after
//!   [`IDLE_EVICT_SECS`] (30 days) without use. `last_seen` refreshes on every
//!   authenticated request and is flushed to disk lazily (~1/min).
//! - The hub AUTO-STARTS on POS launch (no pairing code issued — the code is
//!   minted on demand by the explicit `companion_start` from "Geräte koppeln");
//!   until `companion_set_auth` arms the proxy, companions get a clear
//!   503 "Mutter noch nicht angemeldet".
//!
//! # Hardening notes (security review)
//!
//! - Proxy: deny-by-default positive allow-set keyed by `(role, method,
//!   exact path / tight prefix)`, plus a belt-and-braces hard-deny list. The
//!   captured path is percent-decoded once and rejected on traversal markers
//!   before any match; the upstream URL is built from validated segments.
//! - Same-subnet guard: every companion request must originate from the
//!   mother's LAN `/24`.
//! - SPA: a strict CSP response header on every response; the SPA JS lives in a
//!   separate `GET /app.js` so `script-src 'self'` holds (no inline script).
//!
//! TODO(hardening): full TLS on the LAN hop is still out of scope — the
//! same-subnet guard + CSP + single-use TTL code are the interim mitigation.
//! Before go-live, terminate TLS on the companion hub (self-signed CA pushed to
//! companions, or a Tauri-side mkcert) so the Bearer-bearing proxy traffic and
//! the companion token are not exposed on the wire.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path as FsPath, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Path, State as AxumState,
    },
    http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{broadcast, oneshot, RwLock};
use tokio::task::JoinHandle;
use tower::limit::ConcurrencyLimitLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::timeout::TimeoutLayer;

/// Fixed LAN port for the companion hub. Picked from the IANA dynamic range so
/// it is unlikely to collide; falls back to an OS-assigned ephemeral port if
/// 8714 is already bound.
///
/// `pub(crate)` so the mDNS daemon advertises `warehouse14.local` on the same
/// fixed port the `.mobileconfig` Web Clip + the TLS leaf target (A1).
pub(crate) const COMPANION_PORT: u16 = 8714;

/// Base URL of the cloud API. The proxy appends `/api/<path>` to this.
const CLOUD_BASE: &str = "https://api.warehouse14.de";

/// Rate limit for `POST /pair`: at most this many attempts per IP per window.
const PAIR_MAX_ATTEMPTS: u32 = 6;
const PAIR_WINDOW: Duration = Duration::from_secs(60);

/// How long a freshly-issued pairing code stays valid (single-use *and*
/// time-boxed). After this the operator must press start again to re-issue.
const PAIR_CODE_TTL: Duration = Duration::from_secs(5 * 60);

/// Global failed-pair-attempt budget. Once this many code mismatches accumulate
/// across all IPs, pairing is locked until the next `companion_start`. Stops a
/// distributed brute-force of the 6-digit space (10^6) cold.
const PAIR_GLOBAL_FAIL_LOCK: u32 = 50;

/// Idle eviction window for a paired companion. A device is evicted only after
/// this long WITHOUT use (`last_seen` refreshes on every authenticated
/// request) — replacing the old 12 h absolute TTL that forced a daily QR
/// re-scan. 30 days idle ≈ "the phone genuinely left the shop".
const IDLE_EVICT_SECS: u64 = 30 * 24 * 60 * 60;

/// File name of the persisted pairing registry inside the app data dir.
/// Contains ONLY SHA-256 token hashes + role/label/timestamps — never a
/// plaintext token.
const PAIRING_STORE_FILE: &str = "companion-pairing.json";

/// Persisted TLS material inside the app data dir. We run a tiny **private CA**:
/// a long-lived root (`companion-ca.*`) that the phone installs ONCE (via the
/// `.mobileconfig` profile), and a short-lived **leaf** (`companion-tls.*`,
/// signed by the root) that the hub actually serves. The leaf auto-rotates under
/// the root, so the phone never re-installs anything. `companion-tls.pem` holds
/// the full chain (leaf + root) so iOS/Android can build it. Keys are chmod 0600
/// on unix; certs are public.
const TLS_CERT_FILE: &str = "companion-tls.pem"; // leaf + CA chain (served)
const TLS_KEY_FILE: &str = "companion-tls.key"; // leaf private key
const TLS_CA_CERT_FILE: &str = "companion-ca.pem"; // root CA cert (installed on phones)
const TLS_CA_KEY_FILE: &str = "companion-ca.key"; // root CA private key (signs leaves)
/// Sidecar holding the leaf's issue date (RFC3339) so we can renew it before the
/// ~398-day Apple cap without parsing the DER back.
const TLS_LEAF_ISSUED_FILE: &str = "companion-tls.issued";

/// Subject-alt-name DNS hosts baked into the companion cert alongside the LAN
/// IPv4. `localhost` covers the on-box webview; `warehouse14.local` is the
/// stable mDNS name the phone connects to (and what the cert is issued for).
const TLS_SAN_LOCALHOST: &str = "localhost";
const TLS_SAN_MDNS: &str = "warehouse14.local";

/// Root CA validity: long (install once, lives for the till's lifetime).
const TLS_CA_VALID_YEARS: i32 = 10;
/// Leaf validity in DAYS. **Apple rejects TLS server certs valid > 398 days**
/// (even self-signed / privately-trusted ones), so the served leaf MUST stay
/// under that. It rotates under the long-lived CA, so the phone keeps trusting.
const TLS_LEAF_VALID_DAYS: i64 = 397;
/// Renew the leaf once it is within this many days of expiry (checked on each
/// hub start — the POS restarts far more often than yearly).
const TLS_LEAF_RENEW_WITHIN_DAYS: i64 = 30;

/// Minimum interval between lazy disk flushes of `last_seen` refreshes. A new
/// pairing or an eviction persists immediately; mere activity bookkeeping is
/// throttled to roughly once a minute.
const PERSIST_MIN_INTERVAL: Duration = Duration::from_secs(60);

/// Hard caps on the in-memory maps so a flood of distinct IPs / stale tokens
/// cannot grow them without bound (M2/M3). When exceeded we sweep expired
/// entries first, then refuse to grow further.
const MAX_TOKENS: usize = 256;
const MAX_RATE_BUCKETS: usize = 1024;

/// Router hardening limits (M2/M3/L2): cap request bodies, bound per-request
/// wall-clock, and cap in-flight concurrency so a companion device cannot
/// exhaust the mother's webview process.
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024; // 4 MiB — JSON is tiny; only base64 photo uploads approach this.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CONCURRENT_REQUESTS: usize = 64;

/// Realtime customer-display WebSocket (phase 3) tuning.
///
/// `CART_CHANNEL_CAPACITY` bounds the `tokio::sync::broadcast` ring: each
/// publish is one message, so even a frantic cashier produces a handful per
/// second. A lagging display (slow Wi-Fi) that overflows the ring is handled by
/// catching `RecvError::Lagged` and pushing the LATEST snapshot, so it never
/// shows a stale cart. `WS_PING_INTERVAL` keeps the socket warm through NAT /
/// Wi-Fi idle timeouts and lets the mother notice a vanished display promptly.
const CART_CHANNEL_CAPACITY: usize = 32;
/// Bounds the POS→phone command broadcast ring (Phase B). Commands are rare
/// operator actions (start/stop scan, focus a field), so a small ring is ample.
const CMD_CHANNEL_CAPACITY: usize = 32;
const WS_PING_INTERVAL: Duration = Duration::from_secs(25);

/// The Tauri event a phone scan is re-emitted on, so the mother React cart can
/// ring it up exactly as if the cashier had scanned locally (Phase B).
const COMPANION_SCAN_EVENT: &str = "companion://scan-result";

/// The strict Content-Security-Policy applied to every companion response. No
/// inline scripts (the SPA JS is a separate `/app.js`); no external origins.
/// `connect-src` lists `ws:`/`wss:` explicitly (alongside `'self'`) so the
/// customer-display realtime socket (`GET /ws`) is permitted while every other
/// origin stays blocked — some browsers do not fold same-origin WebSocket under
/// a bare `'self'`, so we name the schemes.
const COMPANION_CSP: &str = "default-src 'self'; script-src 'self'; \
style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; \
img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

/// The companion SPA logic, embedded at build time and served from `/app.js`
/// so the CSP can require `script-src 'self'` (no inline script).
const COMPANION_APP_JS: &str = include_str!("../../companion-web/app.js");

/// The companion SPA, embedded at build time. Single self-contained file —
/// no external assets, no CDNs (works offline + satisfies a tight CSP).
const COMPANION_SPA: &str = include_str!("../../companion-web/index.html");

// ─────────────────────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────────────────────

/// The three companion faces. Encoded into the minted token and used to key the
/// proxy allow-list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    /// Stock-room phone/tablet: inventory/product reads + adjust. No payments.
    Warehouse,
    /// Second till tablet: catalog + transaction finalize/recent.
    Cashier,
    /// Customer-facing iPad: read-only catalog / customer-display reads.
    Display,
}

impl Role {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "warehouse" => Some(Role::Warehouse),
            "cashier" => Some(Role::Cashier),
            "display" => Some(Role::Display),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Role::Warehouse => "warehouse",
            Role::Cashier => "cashier",
            Role::Display => "display",
        }
    }

    /// German default device label, used when the pairing request carries no
    /// explicit label (UI is 100% German).
    fn german_label(self) -> &'static str {
        match self {
            Role::Warehouse => "Lager-Gerät",
            Role::Cashier => "Zweitkasse",
            Role::Display => "Kundenanzeige",
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC snapshot
// ─────────────────────────────────────────────────────────────────────────────

/// Snapshot of the companion server returned to the React layer over IPC.
///
/// Serializes `camelCase` to match the shared TS contract:
/// `{ running, url, port, pairingCode, qrSvg, pairedCount, pairedDevices,
/// secure, tlsFingerprint }`. `secure` + `tlsFingerprint` are additive — older
/// TS consumers simply ignore them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInfo {
    /// Whether the embedded server is currently bound and serving.
    pub running: bool,
    /// LAN URL of the server. `https://192.168.1.20:8714` when TLS is active,
    /// `http://…` on the plain-http fallback, `""` when down.
    pub url: String,
    /// The bound TCP port. `0` when down.
    pub port: u16,
    /// Fresh 6-digit numeric pairing code. `""` when down OR when the hub was
    /// auto-started (a code is only minted by the explicit "Geräte koppeln"
    /// `companion_start`).
    pub pairing_code: String,
    /// SVG of a QR code encoding `url`. `""` when down.
    pub qr_svg: String,
    /// Number of currently paired (non-idle-expired) companion devices.
    pub paired_count: usize,
    /// German labels of the paired devices, sorted, for the Einstellungen UI.
    pub paired_devices: Vec<String>,
    /// True when the hub is serving over HTTPS (secure context for phone
    /// `getUserMedia` / `BarcodeDetector`); false on the plain-http fallback.
    pub secure: bool,
    /// SHA-256 fingerprint (lowercase hex, colon-free) of the self-signed TLS
    /// certificate, so the pairing screen can show it for a one-time trust.
    /// `None` when serving plain http.
    pub tls_fingerprint: Option<String>,
    /// `{url}/trust` — the German iOS/Android onboarding page (install CA + Web
    /// Clip). The pairing panel surfaces it as an "iPhone einrichten" QR/link
    /// (A2). `""` when the hub is down.
    pub trust_url: String,
    /// SVG QR encoding `trust_url`, rendered natively via `qr_svg_for` so the
    /// phone can open /trust by scanning. `""` when down.
    pub trust_qr_svg: String,
}

impl CompanionInfo {
    /// The "not running" snapshot — every field empty/zero.
    fn stopped() -> Self {
        Self {
            running: false,
            url: String::new(),
            port: 0,
            pairing_code: String::new(),
            qr_svg: String::new(),
            paired_count: 0,
            paired_devices: Vec::new(),
            secure: false,
            tls_fingerprint: None,
            trust_url: String::new(),
            trust_qr_svg: String::new(),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared hub state (lives across requests; cloned into the axum router)
// ─────────────────────────────────────────────────────────────────────────────

/// A paired companion device entry in the registry.
///
/// Timestamps are WALL-CLOCK unix seconds (not `Instant`) so the entry
/// round-trips through the persisted pairing store across app restarts.
#[derive(Debug, Clone)]
struct CompanionEntry {
    role: Role,
    /// Human label for the Einstellungen UI ("Lager-Gerät", "iPhone Basel"…).
    label: String,
    /// Unix seconds when the device paired.
    created_unix: u64,
    /// Unix seconds of the last authenticated use — drives idle eviction.
    last_seen_unix: u64,
}

impl CompanionEntry {
    /// IDLE-based expiry: a device is evicted only after [`IDLE_EVICT_SECS`]
    /// without use. Every authenticated request refreshes `last_seen_unix`.
    fn is_expired(&self, now_unix: u64) -> bool {
        now_unix.saturating_sub(self.last_seen_unix) > IDLE_EVICT_SECS
    }
}

/// One device row in the on-disk pairing store. Keyed by SHA-256(token) hex in
/// [`PairingStore::devices`] — the plaintext token NEVER touches disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedDevice {
    role: String,
    label: String,
    created_unix: u64,
    last_seen_unix: u64,
}

/// The on-disk pairing registry (serde_json, atomic tmp+rename write).
#[derive(Debug, Default, Serialize, Deserialize)]
struct PairingStore {
    version: u32,
    /// SHA-256(token) hex → device.
    devices: HashMap<String, PersistedDevice>,
}

/// Per-IP rate-limit bucket for `POST /pair`.
#[derive(Debug, Clone)]
struct RateBucket {
    count: u32,
    window_start: Instant,
}

/// Inner shared state used by the axum handlers. Held behind an `RwLock` inside
/// [`HubShared`]; each field is accessed under a short async lock.
#[derive(Default)]
struct HubInner {
    /// The current single-use pairing code. Empty until a server starts and
    /// CLEARED on the first successful pair; rotated on every `companion_start`.
    pairing_code: String,
    /// When the current `pairing_code` was issued — drives [`PAIR_CODE_TTL`].
    /// `None` when no code is live.
    code_issued_at: Option<Instant>,
    /// The mother's LAN IPv4 at start time. Companion requests must originate
    /// from the same `/24` (H3 same-subnet guard). `None` when not running.
    lan_ip: Option<Ipv4Addr>,
    /// Global count of failed code attempts since the last `companion_start`.
    /// Once it reaches [`PAIR_GLOBAL_FAIL_LOCK`], pairing is locked until the
    /// next start (H1 distributed-brute-force lock).
    global_fail_count: u32,
    /// The mother's cloud session Bearer. Empty until `companion_set_auth`.
    bearer: String,
    /// The latest published cart snapshot (raw JSON string). `None` → default.
    cart_json: Option<String>,
    /// SHA-256(token) hex -> paired companion. Persisted to
    /// [`PAIRING_STORE_FILE`]; survives restarts (30-day idle eviction).
    tokens: HashMap<String, CompanionEntry>,
    /// client-ip -> rate bucket for `POST /pair`.
    pair_rate: HashMap<String, RateBucket>,
    /// Where the pairing registry is persisted. `None` until the app data dir
    /// is resolved at launch (then it stays set for the process lifetime).
    store_path: Option<PathBuf>,
    /// True when in-memory pairing state has changed since the last flush.
    store_dirty: bool,
    /// When the registry was last flushed — throttles the lazy persist.
    last_persist: Option<Instant>,
}

/// Shared companion-hub state. Cloned cheaply (Arc) into the router so every
/// request handler reads the same registry, bearer, cart, and rate buckets.
///
/// Distinct from [`CompanionState`] (which holds the *lifecycle* handle): this
/// one is the long-lived application state and survives start/stop cycles, so
/// the mother's Bearer and the latest cart can be set even before the server is
/// running.
///
/// The `cart_tx` is the broadcast end of the realtime customer-display feed
/// (phase 3): `companion_publish_cart` sends the latest cart JSON on it and
/// every connected `/ws` display subscribes to it. It lives OUTSIDE the
/// `RwLock` so a publish never has to take the write lock just to fan out, and
/// so it survives start/stop (a reconnecting display picks the channel back up).
#[derive(Clone)]
struct HubShared {
    inner: Arc<RwLock<HubInner>>,
    /// Broadcast sender for the live cart feed → subscribed `/ws` displays.
    cart_tx: broadcast::Sender<String>,
    /// Broadcast sender for POS→phone commands → subscribed `/ws` command
    /// sockets (Warehouse/Cashier). Each payload is `{deviceId, action}`; a
    /// phone forwards only commands addressed to its own device id (Phase B).
    cmd_tx: broadcast::Sender<String>,
    /// App handle used to re-emit an inbound phone scan to the mother React
    /// layer. `None` until the setup wires it; emit is best-effort (Phase B).
    app: Arc<Mutex<Option<AppHandle>>>,
}

impl Default for HubShared {
    fn default() -> Self {
        let (cart_tx, _) = broadcast::channel(CART_CHANNEL_CAPACITY);
        let (cmd_tx, _) = broadcast::channel(CMD_CHANNEL_CAPACITY);
        Self {
            inner: Arc::new(RwLock::new(HubInner::default())),
            cart_tx,
            cmd_tx,
            app: Arc::new(Mutex::new(None)),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle handle + Tauri-managed state
// ─────────────────────────────────────────────────────────────────────────────

/// Live handle to a running companion server. Held inside [`CompanionState`].
struct RunningCompanion {
    info: CompanionInfo,
    /// Fires the graceful-shutdown signal when dropped/taken on stop.
    shutdown: oneshot::Sender<()>,
    /// The spawned serve task. Awaited best-effort on stop.
    task: JoinHandle<()>,
}

/// Tauri-managed state: the lifecycle handle (`Some` while running) plus the
/// long-lived [`HubShared`] application state.
///
/// The `running` slot is a plain (non-async) `Mutex` — every access is a quick
/// lock to read the snapshot or swap the handle, with no `.await` held across
/// the guard. The `hub` is `RwLock`-guarded async state shared with the axum
/// handlers.
#[derive(Clone, Default)]
pub struct CompanionState {
    running: Arc<Mutex<Option<RunningCompanion>>>,
    hub: HubShared,
}

impl CompanionState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Wire the Tauri app handle so an inbound phone scan can be re-emitted to
    /// the mother React layer (Phase B). Called once at setup. Idempotent.
    pub fn set_app_handle(&self, app: AppHandle) {
        if let Ok(mut guard) = self.hub.app.lock() {
            *guard = Some(app);
        }
    }
}

/// Keep the mother awake while the companion hub is serving, so a display-sleep /
/// idle-sleep / App Nap never silently kills the LAN server and drops every phone
/// mid-shift. macOS uses a `caffeinate` child with `-w <our pid>`, so the hold
/// auto-releases the instant the POS exits or crashes — it can never strand the
/// machine awake. Windows (`ES_SYSTEM_REQUIRED`) is a guarded follow-up that
/// needs testing on the shop till, so it is a no-op here and the build is
/// unaffected on every platform.
#[cfg(target_os = "macos")]
mod power_hold {
    use std::process::Child;
    use std::sync::Mutex;
    static HOLD: Mutex<Option<Child>> = Mutex::new(None);
    pub fn acquire() {
        let mut g = HOLD.lock().unwrap_or_else(|p| p.into_inner());
        if g.is_some() {
            return;
        }
        let pid = std::process::id().to_string();
        // -i no idle sleep, -s no system sleep (on AC), -w wait on our PID.
        match std::process::Command::new("/usr/bin/caffeinate")
            .args(["-i", "-s", "-w", &pid])
            .spawn()
        {
            Ok(child) => *g = Some(child),
            Err(e) => eprintln!("warehouse14-pos: caffeinate power hold failed: {e}"),
        }
    }
    pub fn release() {
        let mut g = HOLD.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(mut child) = g.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
#[cfg(not(target_os = "macos"))]
mod power_hold {
    pub fn acquire() {}
    pub fn release() {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Interface-name prefixes that are NEVER the real Wi-Fi/LAN: VPN tunnels
/// (ProtonVPN, WireGuard, OpenVPN, IPSec), Docker/OrbStack/VM bridges, and other
/// virtual adapters. An address on one of these is the wrong IP to put in the
/// pairing QR (the iPad can't reach it) and the wrong base for the subnet guard.
///
/// Matching is case-insensitive prefix on the OS interface name. macOS hands out
/// `utun*`/`ppp*`/`ipsec*` for VPNs and `bridge*`/`vmenet*`/`ap*`/`llw*` for
/// virtual/AWDL adapters; OrbStack/Docker/VirtualBox/VMware use
/// `vnic*`/`docker*`/`veth*`/`vboxnet*`/`vmnet*`; Linux/Windows VPNs use
/// `tun*`/`tap*`/`wg*`/`zt*`/`tailscale*`.
const VIRTUAL_IFACE_PREFIXES: &[&str] = &[
    "utun",
    "tun",
    "tap",
    "ppp",
    "ipsec",
    "wg",
    "zt",
    "tailscale",
    "proton",
    "bridge",
    "vmenet",
    "vnic",
    "docker",
    "veth",
    "vboxnet",
    "vmnet",
    "vmwarevmnet",
    "ap",
    "awdl",
    "llw",
    "gif",
    "stf",
    "anpi",
    "lo",
];

/// True when an interface name looks like a virtual / VPN / container adapter
/// (case-insensitive prefix match against [`VIRTUAL_IFACE_PREFIXES`]).
fn is_virtual_iface(name: &str) -> bool {
    let lname = name.to_ascii_lowercase();
    VIRTUAL_IFACE_PREFIXES.iter().any(|p| lname.starts_with(p))
}

/// True when `ip` is an RFC-1918 private LAN IPv4 (`10/8`, `172.16/12`,
/// `192.168/16`). These are the only addresses we put in the pairing URL.
fn is_private_lan_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 10 || (o[0] == 172 && (16..=31).contains(&o[1])) || (o[0] == 192 && o[1] == 168)
}

/// Resolve the REAL Wi-Fi/LAN IPv4 for the pairing URL and the subnet guard.
///
/// The mother Mac may also run ProtonVPN (`utun*`/`ppp*`) and OrbStack/Docker
/// (`bridge*`/`vnic*`/`docker*`), so `local_ip_address::local_ip()` can hand
/// back a VPN or virtual-interface IP — the wrong address to advertise to an
/// iPad and the wrong base for the `/24` guard. Instead we enumerate every
/// IPv4 interface and pick a *private LAN* address on a *physical* interface,
/// deprioritising known virtual/VPN names.
///
/// Selection order:
///   1. private LAN IPv4 on a non-virtual interface  (the real Wi-Fi/Ethernet)
///   2. any private LAN IPv4 (even on a flagged interface) — better than nothing
///   3. `local_ip_address::local_ip()` if it yields a private LAN v4
///   4. loopback (offline / link-down)
///
/// `pub(crate)` so the mDNS daemon (commands::mdns) can pin the
/// `warehouse14.local` A-record to the same Wi-Fi NIC (A1).
pub(crate) fn lan_ip() -> Ipv4Addr {
    // 1+2) Enumerate all AF_INET interfaces and partition by physical vs virtual.
    if let Ok(ifaces) = local_ip_address::list_afinet_netifas() {
        let mut physical_private: Option<Ipv4Addr> = None;
        let mut any_private: Option<Ipv4Addr> = None;
        for (name, addr) in &ifaces {
            let v4 = match addr {
                IpAddr::V4(v4) => *v4,
                IpAddr::V6(_) => continue,
            };
            if v4.is_loopback() || v4.is_link_local() || v4.is_unspecified() {
                continue;
            }
            if !is_private_lan_v4(v4) {
                continue; // public / CGNAT — never the LAN address we advertise.
            }
            if !is_virtual_iface(name) {
                // First physical private hit wins — that's the real LAN NIC.
                if physical_private.is_none() {
                    physical_private = Some(v4);
                }
            } else if any_private.is_none() {
                any_private = Some(v4);
            }
        }
        if let Some(ip) = physical_private {
            eprintln!("warehouse14-pos: companion LAN IP (physical) = {ip}");
            return ip;
        }
        if let Some(ip) = any_private {
            eprintln!("warehouse14-pos: companion LAN IP (virtual-iface fallback) = {ip}");
            return ip;
        }
    }

    // 3) Last resort before loopback: the crate's best guess, but only if it is
    //    itself a private LAN v4 (a VPN/public IP here would be worse than lo).
    if let Ok(IpAddr::V4(v4)) = local_ip_address::local_ip() {
        if is_private_lan_v4(v4) {
            eprintln!("warehouse14-pos: companion LAN IP (local_ip fallback) = {v4}");
            return v4;
        }
    }

    // 4) Offline / link-down.
    eprintln!("warehouse14-pos: companion LAN IP unresolved; using loopback");
    Ipv4Addr::LOCALHOST
}

/// Draw a uniform `u32` in `0..1_000_000` from the OS CSPRNG using rejection
/// sampling (so the modulo bias is zero). `None` on a CSPRNG failure — the
/// caller then REFUSES to issue a code rather than fall back to a weak RNG.
fn csprng_code_value() -> Option<u32> {
    // 0..1_000_000 fits in 20 bits; the largest multiple of 1_000_000 below
    // 2^32 is the rejection threshold. Reject above it to keep the draw uniform.
    const LIMIT: u32 = 1_000_000;
    const REJECT_AT: u32 = u32::MAX - (u32::MAX % LIMIT); // exclusive bound.
    loop {
        let mut buf = [0u8; 4];
        if getrandom::getrandom(&mut buf).is_err() {
            return None;
        }
        let v = u32::from_le_bytes(buf);
        if v < REJECT_AT {
            return Some(v % LIMIT);
        }
    }
}

/// Generate a fresh 6-digit numeric pairing code (zero-padded) from the OS
/// CSPRNG. `None` if the CSPRNG is unavailable — never a weak fallback.
fn fresh_pairing_code() -> Option<String> {
    csprng_code_value().map(|v| format!("{v:06}"))
}

/// Mint an opaque companion token: 32 bytes from the OS CSPRNG, hex-encoded
/// (64 chars). Never derived from the pairing code. Returns `None` on a CSPRNG
/// failure so the caller can REFUSE (503) instead of minting a weak token.
fn mint_token() -> Option<String> {
    let mut buf = [0u8; 32];
    if getrandom::getrandom(&mut buf).is_err() {
        return None;
    }
    let mut s = String::with_capacity(64);
    for b in buf {
        s.push_str(&format!("{b:02x}"));
    }
    Some(s)
}

/// Decide whether `peer` may reach the companion hub given the mother's LAN
/// IPv4 (H3 same-subnet guard, made network-robust).
///
/// The strict `/24` assumption is too tight for some real networks (a /23 or
/// /16 home/office LAN, or a mother whose LAN IP we couldn't confidently pin
/// down). So the policy is:
///
///   - Loopback (v4 or v6) is ALWAYS allowed — the mother, its webview, and
///     on-box diagnostics.
///   - If the mother IP could NOT be confidently determined (it resolved to
///     loopback), FALL BACK to allowing any RFC-1918 private peer rather than
///     hard-blocking legitimate devices. Public peers are still rejected.
///   - Otherwise allow a v4 peer that is EITHER on the mother's `/24` OR a
///     private LAN address in the SAME RFC-1918 range as the mother. Reject
///     clearly-public peers.
///   - IPv6 peers (other than loopback) are rejected — they can't be on the
///     IPv4 LAN we serve.
///
/// Returns `(allowed, reason)`; the reason is logged by the caller.
fn subnet_decision(mother: Ipv4Addr, peer: IpAddr) -> (bool, &'static str) {
    match peer {
        IpAddr::V4(v4) => {
            if v4.is_loopback() {
                return (true, "loopback");
            }
            // Mother IP unknown (loopback ⇒ we never pinned a real LAN IP):
            // don't hard-block — allow any private peer, reject public.
            if mother.is_loopback() {
                return if is_private_lan_v4(v4) {
                    (true, "mother-unknown: private peer allowed")
                } else {
                    (false, "mother-unknown: public peer rejected")
                };
            }
            // Same /24 — the common, tightest case.
            let m = mother.octets();
            let p = v4.octets();
            if m[0] == p[0] && m[1] == p[1] && m[2] == p[2] {
                return (true, "same /24");
            }
            // Same RFC-1918 range (handles /23, /22, /16 LANs the /24 misses).
            if is_private_lan_v4(mother) && is_private_lan_v4(v4) && same_private_range(mother, v4)
            {
                return (true, "same private range");
            }
            (false, "off-subnet")
        }
        // IPv6 peers can't be on the IPv4 LAN; allow only IPv6 loopback.
        IpAddr::V6(v6) => {
            if v6.is_loopback() {
                (true, "loopback")
            } else {
                (false, "ipv6 off-subnet")
            }
        }
    }
}

/// True when two private IPv4 addresses fall in the same RFC-1918 block
/// (`10/8`, `172.16/12`, or `192.168/16`). For `192.168/16` we additionally
/// require the same third octet so two unrelated `192.168.x` LANs bridged by a
/// VPN don't see each other.
fn same_private_range(a: Ipv4Addr, b: Ipv4Addr) -> bool {
    let ao = a.octets();
    let bo = b.octets();
    if ao[0] == 10 && bo[0] == 10 {
        return true;
    }
    if ao[0] == 172 && bo[0] == 172 && (16..=31).contains(&ao[1]) && (16..=31).contains(&bo[1]) {
        return true;
    }
    if ao[0] == 192 && ao[1] == 168 && bo[0] == 192 && bo[1] == 168 {
        return ao[2] == bo[2];
    }
    false
}

/// Render `url` as an SVG QR code (black on white). Returns `""` on the
/// vanishingly-rare encode failure so the caller never has to handle an error.
fn qr_svg_for(url: &str) -> String {
    use qrcode::render::svg;
    match qrcode::QrCode::new(url.as_bytes()) {
        Ok(code) => code
            .render::<svg::Color>()
            .min_dimensions(220, 220)
            .dark_color(svg::Color("#000000"))
            .light_color(svg::Color("#ffffff"))
            .build(),
        Err(_) => String::new(),
    }
}

/// Default cart payload when nothing has been published yet.
fn default_cart() -> &'static str {
    r#"{"items":[],"totalEur":"0.00"}"#
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistent pairing registry (hash-only, atomic writes, idle eviction)
// ─────────────────────────────────────────────────────────────────────────────

/// Wall-clock now as unix seconds. `0` only if the clock is before 1970 —
/// in that pathological case entries simply never idle-expire until it heals.
fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// SHA-256 of a companion token, lowercase hex. The registry (memory AND disk)
/// is keyed by this — the plaintext token never persists anywhere on the
/// mother. Preimage resistance makes the stored hash useless to an attacker
/// who reads the file.
fn token_hash_hex(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let digest = hasher.finalize();
    let mut s = String::with_capacity(64);
    for b in digest {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Sanitize a device label from the pairing request: trim, strip control
/// chars, cap at 40 chars; falls back to the role's German default label.
fn sanitize_label(raw: &str, role: Role) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(40)
        .collect();
    if cleaned.is_empty() {
        role.german_label().to_string()
    } else {
        cleaned
    }
}

/// Build the serializable store from the live registry, skipping entries that
/// are already idle-expired (they'd be evicted on load anyway).
fn store_snapshot(inner: &HubInner) -> PairingStore {
    let now = now_unix();
    PairingStore {
        version: 1,
        devices: inner
            .tokens
            .iter()
            .filter(|(_, e)| !e.is_expired(now))
            .map(|(hash, e)| {
                (
                    hash.clone(),
                    PersistedDevice {
                        role: e.role.as_str().to_string(),
                        label: e.label.clone(),
                        created_unix: e.created_unix,
                        last_seen_unix: e.last_seen_unix,
                    },
                )
            })
            .collect(),
    }
}

/// Atomically write the pairing store: serialize → `<path>.tmp` → rename over
/// `path`. On unix the file is chmod 0600 before the rename. The parent dir is
/// created if missing (fresh install).
fn write_store_atomic(path: &FsPath, store: &PairingStore) -> std::io::Result<()> {
    let json = serde_json::to_vec_pretty(store)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, path)
}

/// Flush the registry to disk NOW (if a store path is configured). Failures
/// are logged, never fatal — the worst case is a re-pair after a crash.
fn persist_now(inner: &mut HubInner) {
    if let Some(path) = inner.store_path.clone() {
        let snapshot = store_snapshot(inner);
        if let Err(err) = write_store_atomic(&path, &snapshot) {
            eprintln!("warehouse14-pos: companion pairing store write failed: {err}");
        }
    }
    inner.store_dirty = false;
    inner.last_persist = Some(Instant::now());
}

/// Mark the registry dirty and flush it if the last flush is older than
/// [`PERSIST_MIN_INTERVAL`] (the lazy ~1/min path for `last_seen` refreshes).
fn persist_lazy(inner: &mut HubInner) {
    inner.store_dirty = true;
    let due = match inner.last_persist {
        Some(t) => t.elapsed() >= PERSIST_MIN_INTERVAL,
        None => true,
    };
    if due {
        persist_now(inner);
    }
}

/// Load the persisted registry into memory, skipping idle-expired devices and
/// unparseable roles. In-memory entries win on conflict (they are fresher).
/// Missing file / parse errors are non-fatal (fresh start).
fn load_store(inner: &mut HubInner) {
    let Some(path) = inner.store_path.clone() else {
        return;
    };
    let raw = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return, // no store yet — first run.
    };
    let store: PairingStore = match serde_json::from_slice(&raw) {
        Ok(s) => s,
        Err(err) => {
            eprintln!(
                "warehouse14-pos: companion pairing store unreadable ({err}); starting empty"
            );
            return;
        }
    };
    let now = now_unix();
    let mut loaded = 0usize;
    for (hash, dev) in store.devices {
        let Some(role) = Role::parse(&dev.role) else {
            continue;
        };
        let entry = CompanionEntry {
            role,
            label: dev.label,
            created_unix: dev.created_unix,
            last_seen_unix: dev.last_seen_unix,
        };
        if entry.is_expired(now) {
            continue;
        }
        inner.tokens.entry(hash).or_insert(entry);
        loaded += 1;
    }
    if loaded > 0 {
        eprintln!("warehouse14-pos: companion pairing store loaded ({loaded} device(s))");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP handlers
// ─────────────────────────────────────────────────────────────────────────────

/// `GET /` and `GET /app.html` — serve the embedded companion SPA shell. The
/// shell pulls its logic from `/app.js` (no inline script) so the CSP holds.
async fn serve_spa() -> Html<&'static str> {
    Html(COMPANION_SPA)
}

/// `GET /app.js` — the companion SPA logic, served as a separate script so the
/// strict CSP can use `script-src 'self'` (no `'unsafe-inline'`).
async fn serve_app_js() -> Response {
    (
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/javascript; charset=utf-8"),
        )],
        COMPANION_APP_JS,
    )
        .into_response()
}

/// `GET /trust/warehouse14-ca.mobileconfig` — the iOS profile that installs the
/// companion root CA + a Web Clip. Served with the Apple aspen-config MIME so
/// Safari offers to install it. The CA cert is read from the same app-data dir
/// the pairing registry lives in.
async fn trust_mobileconfig_handler(AxumState(hub): AxumState<HubShared>) -> Response {
    let dir = {
        let inner = hub.inner.read().await;
        inner
            .store_path
            .as_ref()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
    };
    let Some(dir) = dir else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Hub not ready").into_response();
    };
    let Ok(ca_pem) = read_ca_cert_pem(&dir) else {
        return (StatusCode::SERVICE_UNAVAILABLE, "CA not ready").into_response();
    };
    let url = format!("https://{TLS_SAN_MDNS}:{COMPANION_PORT}");
    let mc = build_mobileconfig(&ca_pem, &url);
    (
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/x-apple-aspen-config"),
            ),
            (
                header::CONTENT_DISPOSITION,
                HeaderValue::from_static("attachment; filename=\"warehouse14.mobileconfig\""),
            ),
        ],
        mc,
    )
        .into_response()
}

/// `GET /trust` — the one-page German onboarding that walks the operator through
/// installing the profile + flipping the Certificate-Trust toggle on iOS.
async fn trust_page_handler() -> Response {
    (
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        )],
        TRUST_HTML,
    )
        .into_response()
}

/// Onboarding page served at `/trust`. Self-contained (no external assets).
const TRUST_HTML: &str = r##"<!doctype html><html lang="de"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f4f2ee">
<title>Warehouse 14 — iPhone einrichten</title>
<style>
 html{touch-action:manipulation}
 body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;margin:0;background:#f4f2ee;color:#1a1a1a}
 .wrap{max-width:560px;margin:0 auto;padding:24px}
 h1{font-size:22px;margin:8px 0 4px;text-wrap:balance}
 /* #5a5a5a on #f4f2ee ≈ 6:1 — clears WCAG AA for this 14px text (was #777 ≈ 4.1). */
 .sub{color:#5a5a5a;margin:0 0 20px;font-size:14px}
 .btn{display:block;text-align:center;background:#1a1a1a;color:#fff;text-decoration:none;padding:16px;border-radius:12px;font-size:17px;font-weight:600;margin:18px 0}
 .btn:hover{background:#333}.btn:active{background:#000}
 .btn:focus-visible{outline:3px solid #1f6f5c;outline-offset:2px}
 ol{padding-left:20px;line-height:1.6}li{margin:10px 0}
 .step{background:#fff;border:1px solid #e3ddd2;border-radius:12px;padding:16px 18px;margin:14px 0}
 .k{font-weight:600}
 /* Step 3 is the one operators skip — louder than a generic note. */
 .warn{background:#fff7e6;border:2px solid #e0a955;border-radius:10px;padding:14px;font-size:14px}
 .warn .k{color:#8a5300}
 code{background:#efece3;padding:2px 6px;border-radius:4px}
</style></head><body><main class="wrap">
 <h1>Warehouse 14 — iPhone einrichten</h1>
 <p class="sub">Einmalig: Zertifikat installieren, dann ist die Kamera-/Scanner-Verbindung sicher.</p>
 <a class="btn" href="/trust/warehouse14-ca.mobileconfig">1 · Profil laden</a>
 <div class="step"><span class="k">2 · Installieren</span><br>
   Einstellungen → Allgemein → VPN &amp; Geräteverwaltung → <span class="k">Geladenes Profil</span> → Installieren.</div>
 <div class="step warn" role="note" aria-label="Wichtiger Schritt"><span class="k">3 · Vertrauen aktivieren (wichtig!)</span><br>
   Einstellungen → Allgemein → Info → <span class="k">Zertifikatsvertrauenseinstellungen</span> → „Warehouse14 Local CA“ <span class="k">einschalten</span>. Ohne diesen Schritt bleibt die Kamera gesperrt.</div>
 <div class="step"><span class="k">4 · Öffnen</span><br>
   <code>https://warehouse14.local:8714</code> öffnen (oder das neue Symbol auf dem Home-Bildschirm) und Kamera erlauben.</div>
 <p class="sub">Hinweis: Beim ersten Laden zeigt das iPhone „Nicht signiert“ — das ist im eigenen WLAN normal.</p>
</main></body></html>"##;

/// `GET /health` — liveness probe for companions / diagnostics.
async fn health() -> &'static str {
    "ok"
}

/// Middleware: stamp the strict CSP (and a couple of companion hardening
/// headers) onto every response, including error responses (H2).
async fn security_headers(req: axum::extract::Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(COMPANION_CSP),
    );
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert("X-Frame-Options", HeaderValue::from_static("DENY"));
    h.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    res
}

/// Middleware: reject any request whose real TCP peer is not on the mother's
/// LAN `/24` (H3 same-subnet guard). Runs before routing so it covers every
/// endpoint uniformly. Loopback is always allowed.
async fn subnet_guard(
    AxumState(hub): AxumState<HubShared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: axum::extract::Request,
    next: Next,
) -> Response {
    let mother = { hub.inner.read().await.lan_ip };
    if let Some(mother) = mother {
        let (allowed, reason) = subnet_decision(mother, peer.ip());
        if !allowed {
            eprintln!(
                "warehouse14-pos: companion subnet guard REJECT peer={} mother={} ({reason})",
                peer.ip(),
                mother
            );
            return (StatusCode::FORBIDDEN, "forbidden: off-subnet").into_response();
        }
    }
    next.run(req).await
}

#[derive(Deserialize)]
struct PairReq {
    code: String,
    role: String,
    /// Optional device name shown in Einstellungen ("iPhone Basel"). Falls
    /// back to the role's German label when absent/empty.
    #[serde(default)]
    label: String,
}

#[derive(Serialize)]
struct PairRes {
    token: String,
    role: String,
}

/// `POST /pair` — verify the pairing code (constant-time, single-use, TTL),
/// validate the role, rate-limit on the REAL TCP peer IP, enforce the global
/// failed-attempt lock, and on success mint a role-scoped companion token.
///
/// The peer IP comes from axum's [`ConnectInfo`] — the real socket address, NOT
/// any `X-Forwarded-For` header (which a companion could forge to dodge the
/// per-IP limit). There is no reverse proxy in front of the LAN hub, so the
/// socket peer is authoritative.
async fn pair_handler(
    AxumState(hub): AxumState<HubShared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(req): Json<PairReq>,
) -> Response {
    let ip = peer.ip().to_string();

    // Role must be one of the three known faces.
    let role = match Role::parse(&req.role) {
        Some(r) => r,
        None => return (StatusCode::FORBIDDEN, "invalid role").into_response(),
    };

    let mut inner = hub.inner.write().await;
    let now = Instant::now();

    // ── Global failed-attempt lock (distributed brute-force defence) ──
    if inner.global_fail_count >= PAIR_GLOBAL_FAIL_LOCK {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            "pairing locked — restart the companion hub",
        )
            .into_response();
    }

    // ── Per-IP rate limit (real peer, sliding fixed window) ──
    // Opportunistically evict stale buckets + cap the map (M2).
    if inner.pair_rate.len() >= MAX_RATE_BUCKETS {
        inner
            .pair_rate
            .retain(|_, b| now.duration_since(b.window_start) <= PAIR_WINDOW);
    }
    {
        let bucket = inner.pair_rate.entry(ip.clone()).or_insert(RateBucket {
            count: 0,
            window_start: now,
        });
        if now.duration_since(bucket.window_start) > PAIR_WINDOW {
            bucket.count = 0;
            bucket.window_start = now;
        }
        bucket.count += 1;
        if bucket.count > PAIR_MAX_ATTEMPTS {
            return (StatusCode::TOO_MANY_REQUESTS, "rate limited").into_response();
        }
    }

    // ── Code must be live: present AND within its TTL (single-use means it is
    //    cleared on first success, so a re-use after success fails here too). ──
    let code_live = !inner.pairing_code.is_empty()
        && inner
            .code_issued_at
            .map(|t| now.duration_since(t) <= PAIR_CODE_TTL)
            .unwrap_or(false);
    if !code_live {
        return (StatusCode::FORBIDDEN, "code expired").into_response();
    }

    // ── Constant-time code compare ──
    let expected = inner.pairing_code.clone();
    let ok: bool = expected.as_bytes().ct_eq(req.code.as_bytes()).into();
    if !ok {
        inner.global_fail_count = inner.global_fail_count.saturating_add(1);
        return (StatusCode::FORBIDDEN, "invalid code").into_response();
    }

    // ── Success: mint the token (refuse if CSPRNG fails), register, and
    //    INVALIDATE the code so it is single-use. ──
    let token = match mint_token() {
        Some(t) => t,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                "secure token generation unavailable",
            )
                .into_response();
        }
    };

    // Single-use: a paired code is spent. Operator must restart to re-issue.
    inner.pairing_code.clear();
    inner.code_issued_at = None;

    // Cap the token map (M3): sweep idle-expired entries first; refuse to grow
    // past the hard cap (a working hub never has 256 live companions on a LAN).
    let now_wall = now_unix();
    if inner.tokens.len() >= MAX_TOKENS {
        inner.tokens.retain(|_, e| !e.is_expired(now_wall));
        if inner.tokens.len() >= MAX_TOKENS {
            return (StatusCode::SERVICE_UNAVAILABLE, "too many paired devices").into_response();
        }
    }

    // Registry keyed by SHA-256(token); the plaintext goes ONLY to the device.
    inner.tokens.insert(
        token_hash_hex(&token),
        CompanionEntry {
            role,
            label: sanitize_label(&req.label, role),
            created_unix: now_wall,
            last_seen_unix: now_wall,
        },
    );
    // A new pairing is rare and precious — flush it to disk immediately so an
    // app restart right after pairing cannot lose the device.
    persist_now(&mut inner);

    Json(PairRes {
        token,
        role: role.as_str().to_string(),
    })
    .into_response()
}

/// Validate a raw companion token string. On success returns the token's role
/// and refreshes its `last_seen`. A token older than [`TOKEN_TTL`] is evicted on
/// use and rejected (H3). On any failure returns `None`.
///
/// Shared by the header-based path ([`auth_role`]) and the WebSocket upgrade,
/// which carries the token in the `Sec-WebSocket-Protocol` handshake header (a
/// browser `new WebSocket(url, [subprotocol])` cannot set arbitrary custom
/// headers, but the subprotocol DOES ride a real request header — keeping the
/// secret out of the URL/history/logs).
async fn auth_role_token(hub: &HubShared, token: &str) -> Option<Role> {
    if token.is_empty() {
        return None;
    }
    // Registry is keyed by SHA-256(token) — hash the presented token first.
    let key = token_hash_hex(token);
    let now = now_unix();
    let mut inner = hub.inner.write().await;
    // Evict-on-use if the device has been idle past the eviction window.
    if let Some(entry) = inner.tokens.get(&key) {
        if entry.is_expired(now) {
            inner.tokens.remove(&key);
            persist_now(&mut inner);
            return None;
        }
    }
    let role = {
        let entry = inner.tokens.get_mut(&key)?;
        entry.last_seen_unix = now;
        entry.role
    };
    // Lazy flush (~1/min) so `last_seen` survives a restart without hammering
    // the disk on every request.
    persist_lazy(&mut inner);
    Some(role)
}

/// Read and validate the `X-Companion-Token` header. On success returns the
/// token's role and refreshes its `last_seen`. A token older than [`TOKEN_TTL`]
/// is evicted on use and rejected (H3). On any failure returns `None`.
async fn auth_role(hub: &HubShared, headers: &HeaderMap) -> Option<Role> {
    let token = headers
        .get("x-companion-token")
        .and_then(|v| v.to_str().ok())?
        .to_string();
    auth_role_token(hub, &token).await
}

/// `GET /cart` — any valid companion may read the latest published cart.
async fn cart_handler(AxumState(hub): AxumState<HubShared>, headers: HeaderMap) -> Response {
    if auth_role(&hub, &headers).await.is_none() {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    let body = {
        let inner = hub.inner.read().await;
        inner
            .cart_json
            .clone()
            .unwrap_or_else(|| default_cart().to_string())
    };
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response()
}

/// Subprotocol prefix that carries the companion token on the `GET /ws`
/// handshake. The client opens `new WebSocket(url, [WS_TOKEN_PROTO_PREFIX +
/// <hex token>])`; the browser puts that value in the `Sec-WebSocket-Protocol`
/// REQUEST header (not the URL), so the secret never lands in history or logs.
/// The server validates the embedded token and, on success, MUST echo the SAME
/// subprotocol back in the response (axum does this via
/// [`WebSocketUpgrade::protocols`]) or the browser fails the handshake.
const WS_TOKEN_PROTO_PREFIX: &str = "w14.token.";

/// Extract the companion token from the `Sec-WebSocket-Protocol` request header.
///
/// The header is a comma-separated list of offered subprotocols; we look for the
/// one beginning with [`WS_TOKEN_PROTO_PREFIX`] and return `(full_subprotocol,
/// token)` so the caller can both validate the token AND echo the exact accepted
/// subprotocol back on upgrade. Returns `None` when no token subprotocol is
/// offered. The token (64 hex chars) is a valid RFC-6455 subprotocol token, so
/// no extra encoding is needed.
fn ws_token_from_protocols(headers: &HeaderMap) -> Option<(String, String)> {
    let raw = headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|v| v.to_str().ok())?;
    raw.split(',')
        .map(|s| s.trim())
        .find(|p| p.starts_with(WS_TOKEN_PROTO_PREFIX))
        .map(|proto| {
            let token = proto[WS_TOKEN_PROTO_PREFIX.len()..].to_string();
            (proto.to_string(), token)
        })
}

/// `GET /ws` — the realtime companion socket. Two role-gated shapes share the
/// endpoint:
///   • **Display** → a strictly OUTBOUND, read-only cart feed: the latest cart
///     JSON on connect and on every `companion_publish_cart`. Inbound frames are
///     ignored; it can never mutate state or reach the proxy.
///   • **Warehouse/Cashier** → a COMMAND socket (Phase B): receives POS→phone
///     commands addressed to this device, and accepts ONLY `scan-result` inbound
///     frames, which are re-emitted to the mother cart. No other inbound shape
///     does anything — a phone cannot drive arbitrary POS actions here.
///
/// Authenticates the companion token (carried in the `Sec-WebSocket-Protocol`
/// handshake header, NOT the URL) BEFORE the upgrade; a missing/invalid token is
/// rejected 401 and never upgrades. On success the accepted token subprotocol is
/// echoed back via [`WebSocketUpgrade::protocols`] so the browser completes the
/// handshake.
async fn ws_handler(
    AxumState(hub): AxumState<HubShared>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    // The token rides the `Sec-WebSocket-Protocol` header, never the URL.
    let (proto, token) = match ws_token_from_protocols(&headers) {
        Some(pair) => pair,
        None => return (StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
    };
    let role = match auth_role_token(&hub, &token).await {
        Some(r) => r,
        None => return (StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
    };
    // Same role model as the proxy/cart: only the customer display rides the
    // realtime feed. A cashier/warehouse token is rejected here (they have no
    // need for the push stream and we keep the surface minimal).
    // The socket's identity = SHA-256(token), the SAME id the pairing registry
    // uses (so a command can address ONE phone). Echo the accepted token
    // subprotocol back — REQUIRED for the browser to complete the handshake.
    let device_id = token_hash_hex(&token);
    match role {
        Role::Display => {
            // Read-only customer-display feed (unchanged): snapshot the cart now
            // so a fresh connect paints immediately, then fan out every change.
            let initial = {
                let inner = hub.inner.read().await;
                inner
                    .cart_json
                    .clone()
                    .unwrap_or_else(|| default_cart().to_string())
            };
            let rx = hub.cart_tx.subscribe();
            ws.protocols([proto])
                .on_upgrade(move |socket| display_ws_loop(socket, initial, rx))
        }
        Role::Warehouse | Role::Cashier => {
            // Phase B — a COMMAND socket: receive POS→phone commands addressed to
            // this device, and accept inbound `scan-result` frames which we
            // re-emit to the mother React cart. This is the ONLY inbound surface;
            // it can never reach the proxy or mutate hub state directly.
            let rx = hub.cmd_tx.subscribe();
            let app = hub.app.lock().ok().and_then(|g| g.clone());
            ws.protocols([proto])
                .on_upgrade(move |socket| command_ws_loop(socket, device_id, rx, app))
        }
    }
}

/// Drive one customer-display WebSocket: send the initial snapshot, then fan out
/// every broadcast cart update, keep the socket warm with periodic pings, and
/// exit cleanly when the client closes or the socket errors.
async fn display_ws_loop(socket: WebSocket, initial: String, mut rx: broadcast::Receiver<String>) {
    let (mut sink, mut stream) = socket.split();

    // Paint immediately with the current cart.
    if sink.send(Message::Text(initial)).await.is_err() {
        return;
    }

    let mut ping = tokio::time::interval(WS_PING_INTERVAL);
    // The first tick fires instantly; skip it so we don't ping before the first
    // real idle window.
    ping.tick().await;

    loop {
        tokio::select! {
            // A new cart was published → push it. On `Lagged` (a slow display
            // overflowed the ring) we don't error — the very next published
            // snapshot is the truth, so we simply continue and let it through.
            recv = rx.recv() => {
                match recv {
                    Ok(cart) => {
                        if sink.send(Message::Text(cart)).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        // Drop the stale gap; the next Ok delivers the latest.
                        continue;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            // Keep-alive ping so NAT / Wi-Fi idle timers don't silently drop us.
            _ = ping.tick() => {
                if sink.send(Message::Ping(Vec::new())).await.is_err() {
                    break;
                }
            }
            // Watch the read half ONLY to notice the client going away (close or
            // transport error). Inbound data frames are intentionally ignored —
            // the display is a read-only sink.
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    Some(Ok(_)) => { /* ignore pongs / stray frames */ }
                }
            }
        }
    }
}

/// True when a broadcast command `{deviceId, ...}` is addressed to this device.
/// A `"*"` deviceId fans out to every command socket; anything else must match
/// this socket's id exactly (so the POS can target ONE phone). A malformed
/// payload addresses no one.
fn command_is_for_device(cmd_json: &str, device_id: &str) -> bool {
    match serde_json::from_str::<serde_json::Value>(cmd_json) {
        Ok(v) => match v.get("deviceId").and_then(|d| d.as_str()) {
            Some("*") => true,
            Some(target) => target == device_id,
            None => false,
        },
        Err(_) => false,
    }
}

/// Pure parse of an inbound command-socket frame: returns the scanned code IFF
/// the frame is exactly `{type:"scan-result", code:"<non-empty string>"}`. Every
/// other shape (other type, missing/non-string/empty code, malformed JSON)
/// returns `None`. This is the ONLY inbound message a phone can act through — it
/// can NEVER drive arbitrary POS actions.
fn scan_code_from_frame(frame: &str) -> Option<String> {
    let v = serde_json::from_str::<serde_json::Value>(frame).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("scan-result") {
        return None;
    }
    let code = v.get("code").and_then(|c| c.as_str())?;
    if code.is_empty() {
        return None;
    }
    Some(code.to_string())
}

/// Handle ONE inbound frame from a command socket: if it is a valid scan-result,
/// re-emit it to the mother React layer (tagged with the authenticated device
/// id) so the cart rings it up exactly as a local scan.
fn handle_inbound_scan(frame: &str, device_id: &str, app: Option<&AppHandle>) {
    let Some(code) = scan_code_from_frame(frame) else {
        return;
    };
    if let Some(app) = app {
        // Best-effort: a closed window must never panic the socket loop.
        let _ = app.emit(
            COMPANION_SCAN_EVENT,
            serde_json::json!({ "deviceId": device_id, "code": code }),
        );
    }
}

/// Drive one Warehouse/Cashier COMMAND socket (Phase B): forward POS→phone
/// commands addressed to this device, keep it warm with pings, and re-emit any
/// inbound `scan-result` to the mother cart. Exits cleanly on close/error.
async fn command_ws_loop(
    socket: WebSocket,
    device_id: String,
    mut rx: broadcast::Receiver<String>,
    app: Option<AppHandle>,
) {
    let (mut sink, mut stream) = socket.split();
    let mut ping = tokio::time::interval(WS_PING_INTERVAL);
    ping.tick().await; // skip the immediate first tick

    loop {
        tokio::select! {
            recv = rx.recv() => {
                match recv {
                    Ok(cmd) => {
                        if command_is_for_device(&cmd, &device_id)
                            && sink.send(Message::Text(cmd)).await.is_err()
                        {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = ping.tick() => {
                if sink.send(Message::Ping(Vec::new())).await.is_err() {
                    break;
                }
            }
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Text(t))) => handle_inbound_scan(&t, &device_id, app.as_ref()),
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    Some(Ok(_)) => { /* ignore pongs / binary / stray frames */ }
                }
            }
        }
    }
}

/// The outcome of normalising the proxy's captured path (C2).
enum NormPath {
    /// A clean, traversal-safe path (already lowercased copy kept for the deny
    /// compare; the original-case path is what we forward upstream).
    Ok { path: String, lower: String },
    /// The path failed validation — the proxy must reject with 400.
    Rejected,
}

/// Percent-decode the captured proxy path ONCE, then reject anything that could
/// escape the `/api/` namespace or smuggle control bytes (C2):
///
/// - reject `..` (path traversal), `//` (empty segment / scheme confusion),
///   any backslash, any ASCII control char, and a leading `/` after decode;
/// - strip a trailing `?query` for matching but keep it for the upstream call;
/// - return both the forward path and a lowercased copy for the deny compare.
fn normalize_proxy_path(raw: &str) -> NormPath {
    use percent_encoding::percent_decode_str;

    // Split off the query string — it is forwarded verbatim but never matched.
    let (path_part, query) = match raw.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (raw, None),
    };

    // Percent-decode exactly once. A non-UTF-8 decode is rejected outright.
    let decoded = match percent_decode_str(path_part).decode_utf8() {
        Ok(s) => s.into_owned(),
        Err(_) => return NormPath::Rejected,
    };

    // Reject traversal / smuggling markers and control bytes.
    if decoded.is_empty()
        || decoded.starts_with('/')
        || decoded.contains("..")
        || decoded.contains("//")
        || decoded.contains('\\')
        || decoded.chars().any(|c| c.is_control())
    {
        return NormPath::Rejected;
    }

    // Each segment must be a plausible path token (no empties — already covered
    // by the `//` check — and no whitespace).
    for seg in decoded.split('/') {
        if seg.is_empty() || seg.chars().any(|c| c.is_whitespace()) {
            return NormPath::Rejected;
        }
    }

    // Validate the query too: re-decode and reject control bytes / backslashes
    // so a crafted `?...` cannot smuggle anything past the upstream.
    let query_clean = match query {
        Some(q) => {
            let dq = match percent_decode_str(q).decode_utf8() {
                Ok(s) => s.into_owned(),
                Err(_) => return NormPath::Rejected,
            };
            if dq.contains('\\') || dq.chars().any(|c| c.is_control()) {
                return NormPath::Rejected;
            }
            // Forward the ORIGINAL (still-encoded) query, MINUS the companion
            // auth-token params (`t` / `access_token`). Those exist only for the
            // `<img>` query-token auth fallback and must never reach the cloud.
            let kept: Vec<&str> = q
                .split('&')
                .filter(|pair| {
                    let key = pair.split_once('=').map(|(k, _)| k).unwrap_or(pair);
                    key != "t" && key != "access_token"
                })
                .collect();
            if kept.is_empty() {
                None
            } else {
                Some(kept.join("&"))
            }
        }
        None => None,
    };

    let lower = decoded.to_ascii_lowercase();
    let path = match query_clean {
        Some(q) => format!("{decoded}?{q}"),
        None => decoded,
    };
    NormPath::Ok { path, lower }
}

/// Belt-and-braces hard-deny gate (SECOND gate). Operates on the lowercased,
/// already-normalised path. Even if a positive rule were ever loosened, none of
/// these namespaces is reachable by any companion.
fn hard_denied(lower_path: &str) -> bool {
    const FORBIDDEN_PREFIXES: &[&str] = &[
        "auth",
        "session",
        "sessions",
        "login",
        "logout",
        "admin",
        "settings",
        "system-settings",
        "users",
        "owner",
        "step-up",
        "stepup",
        "tse",
        "fiskaly",
        "export",
        "gdpr",
        "kyc",
    ];
    // The first segment (before any `/`) — deny exact or prefix match.
    let seg0 = lower_path.split('/').next().unwrap_or("");
    if FORBIDDEN_PREFIXES.contains(&seg0) {
        return true;
    }
    // Defence in depth: deny anything mentioning void / refund / storno /
    // ankauf / return anywhere in the path, regardless of role.
    const FORBIDDEN_SUBSTR: &[&str] = &[
        "void", "refund", "storno", "ankauf", "return", "delete", "destroy",
    ];
    FORBIDDEN_SUBSTR.iter().any(|s| lower_path.contains(s))
}

/// True when `lower_path` is exactly `products/<id>/<action>` (three segments,
/// none empty) with the third segment equal to `action`. Used to allow the
/// warehouse stock-adjust POST (`products/<id>/inventory-adjustment`) WITHOUT
/// over-granting any other product sub-action (e.g. `archive`, `photos`).
fn is_product_item_action(lower_path: &str, action: &str) -> bool {
    let mut it = lower_path.split('/');
    matches!(
        (it.next(), it.next(), it.next(), it.next()),
        (Some("products"), Some(id), Some(a), None) if !id.is_empty() && a == action
    )
}

/// True when `lower_path` is exactly `<base>/<id>/<action>` (three segments,
/// none empty) with the first segment equal to `base` and the third equal to
/// `action`. The generic sibling of [`is_product_item_action`], used to allow
/// the warehouse "set primary photo" PATCH (`photos/<id>/primary`) WITHOUT
/// over-granting any other photo sub-action (e.g. `workflow-state`).
fn is_item_action(lower_path: &str, base: &str, action: &str) -> bool {
    let mut it = lower_path.split('/');
    matches!(
        (it.next(), it.next(), it.next(), it.next()),
        (Some(b), Some(id), Some(a), None) if b == base && !id.is_empty() && a == action
    )
}

/// True when `lower_path` is exactly `<base>/<id>` (two segments, id
/// non-empty) — the item-level sibling of [`is_item_action`]. Used to allow
/// the warehouse appointment status PATCH (`appointments/<id>`) WITHOUT
/// matching any deeper sub-action (e.g. `appointments/<id>/reschedule`).
fn is_single_item(lower_path: &str, base: &str) -> bool {
    let mut it = lower_path.split('/');
    matches!(
        (it.next(), it.next(), it.next()),
        (Some(b), Some(id), None) if b == base && !id.is_empty()
    )
}

/// The ONLY appointment-PATCH body shape a companion may send: the status
/// transition `{ status, cancellationReason?, staffNotes? }` from the live
/// `PATCH /api/appointments/:id` contract. Any extra key, wrong type, or
/// unknown status value is rejected — a companion can move an appointment
/// through its state graph but can never repurpose the PATCH for anything
/// else.
fn is_appointment_status_patch_body(body: &[u8]) -> bool {
    const ALLOWED_STATUS: &[&str] = &[
        "CONFIRMED",
        "CHECKED_IN",
        "IN_PROGRESS",
        "COMPLETED",
        "NO_SHOW",
        "CANCELLED",
    ];
    let value: serde_json::Value = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let Some(obj) = value.as_object() else {
        return false;
    };
    // `status` is mandatory and must be a known transition.
    match obj.get("status").and_then(|s| s.as_str()) {
        Some(s) if ALLOWED_STATUS.contains(&s) => {}
        _ => return false,
    }
    // Every other key must be one of the two optional string fields.
    obj.iter().all(|(k, v)| match k.as_str() {
        "status" => true,
        "cancellationReason" | "staffNotes" => v.is_string(),
        _ => false,
    })
}

/// Role-scoped POSITIVE allow-set for the proxy (C1) — deny-by-default.
///
/// Returns `true` only when `role` may call `method <lower_path>`, where
/// `lower_path` is the normalised, lowercased segment AFTER `/api/` (no query).
/// Matching is by EXACT path or a tight allow-prefix — never a broad
/// `transactions/` / `inventory/` prefix that would over-grant payouts, voids,
/// or refunds.
fn proxy_allowed(role: Role, method: &Method, lower_path: &str) -> bool {
    let is_get = method == Method::GET;
    let is_post = method == Method::POST;
    let is_put = method == Method::PUT;
    let is_patch = method == Method::PATCH;
    let p = lower_path;

    // A read is allowed against `base` if the path is exactly `base` or a
    // sub-resource `base/<id>` (one extra segment), but NOT a sibling action.
    let get_under = |base: &str| -> bool { p == base || p.starts_with(&format!("{base}/")) };

    // `products/<id>` is a single sub-resource edit (one extra segment, no
    // trailing action verb). Used by the warehouse PUT (rename / re-price /
    // re-shelve / DRAFT→AVAILABLE). It must NOT match `products/<id>/archive`
    // or any other action sub-path, so we require exactly two segments.
    let is_product_item = || -> bool {
        let mut it = p.split('/');
        matches!((it.next(), it.next(), it.next()), (Some("products"), Some(id), None) if !id.is_empty())
    };

    match role {
        // Display: read-only price/cart display reads. A customer-facing screen
        // needs catalog/price reads only — NOT the customer directory.
        Role::Display => {
            is_get
                && (get_under("products")
                    || get_under("catalog")
                    || get_under("customer-display")
                    || get_under("metal-prices")
                    || get_under("metal-rates"))
        }
        // Cashier: catalog/customer reads + recent transactions + appointment
        // READS (the Zweitkasse sees the Termine list, never writes it); POST
        // limited to cart-create + finalize + the reversible, non-fiscal
        // inventory reserve/release that the real Zweitkasse till needs to put
        // a unique item under a cart hold and let it go again. NEVER ankauf /
        // storno / return / void / refund (blocked positively here AND by
        // `hard_denied`). Both reserve and release are reversible and move no
        // money (the cloud routes gate step-up at finalize only), so granting
        // them here does not widen the money surface.
        Role::Cashier => {
            (is_get
                && (get_under("products")
                    || get_under("catalog")
                    || get_under("customers")
                    || get_under("metal-prices")
                    || get_under("metal-rates")
                    || get_under("appointments")
                    // public photo renditions only (id-scoped) so the till's
                    // catalog tiles show the same thumbnails as the Lager list.
                    || is_item_action(p, "photos", "thumb")
                    || is_item_action(p, "photos", "raw")
                    || p == "transactions"
                    || p == "transactions/recent"))
                || (is_post
                    && (p == "transactions"
                        || p == "transactions/finalize"
                        || p == "inventory/reserve"
                        || p == "inventory/release"))
        }
        // Warehouse: the stock-room's full inventory job, least-privilege.
        //
        // READS  — list/search products (`products`, `products?q=…`), one
        //          product (`products/<id>`), its photos
        //          (`products/<id>/photos`), the catalog, inventory reads, the
        //          category tree, and storefront locations/bins (read-only) so
        //          the picker can pick a shelf. `get_under("products")` already
        //          subsumes the per-item + photos reads; the explicit
        //          `categories` / `storefront/locations` add the taxonomy +
        //          bin reads the intake form needs.
        // WRITES — create a product (`POST products`), edit one product
        //          (`PUT products/<id>`: rename / re-price / re-shelve /
        //          DRAFT→AVAILABLE), the stock-adjust POST
        //          (`products/<id>/inventory-adjustment` + `inventory/adjust`),
        //          the LOCATION-ONLY re-shelve POST
        //          (`products/<id>/relocate` — the no-step-up route so a phone
        //          re-shelve actually succeeds; quantity/status stay on the
        //          step-up-gated inventory-adjustment), request a photo-upload
        //          URL (`POST products/<id>/photos`), upload a photo through the
        //          api (`POST photos/upload`), register an uploaded photo
        //          (`POST photos`), and set the product's primary photo
        //          (`PATCH photos/<id>/primary`).
        //
        // TERMINE (phone Termine tab) — appointments reads (`appointments`,
        //          `appointments/<id>`, `?from/to` rides the stripped query),
        //          create (`POST appointments`), and the item-level status
        //          PATCH (`appointments/<id>` ONLY — `proxy_handler`
        //          additionally pins the PATCH body to the status-transition
        //          shape). Customer READS (`customers`, `customers/<id>`,
        //          search via query) so a Termin can be linked to a customer —
        //          never a customer write.
        //
        // NEVER any transaction, payout, ankauf, storno, archive/delete, photo
        // workflow-state transition, or category mutation — those are blocked
        // positively here (deny-by-default) AND by `hard_denied`. Label/barcode
        // printing is a CLIENT-side thermal-print action, not an api route, so
        // there is nothing to allow here for it.
        Role::Warehouse => {
            (is_get
                && (get_under("products")
                    || get_under("catalog")
                    || get_under("inventory")
                    || get_under("categories")
                    || get_under("storefront/locations")
                    || get_under("appointments")
                    || get_under("customers")
                    // public photo renditions only (id-scoped) so the inventory
                    // list can render thumbnails — NOT photos/unassigned|usage.
                    || is_item_action(p, "photos", "thumb")
                    || is_item_action(p, "photos", "raw")))
                || (is_post
                    && (p == "products"
                        || p == "photos"
                        || p == "photos/upload"
                        || p == "inventory/adjust"
                        || p == "appointments"
                        || is_product_item_action(p, "inventory-adjustment")
                        || is_product_item_action(p, "relocate")
                        || is_product_item_action(p, "photos")))
                || (is_put && is_product_item())
                || (is_patch
                    && (is_item_action(p, "photos", "primary")
                        || is_single_item(p, "appointments")))
        }
    }
}

/// Extract a companion token from a request query string (`t=` or
/// `access_token=`). This is the auth fallback for GET image renditions: a
/// browser `<img>` cannot send the `X-Companion-Token` header, so the SPA carries
/// the token in the photo URL's query. Never honoured for writes (GET-only at the
/// call site) and stripped from the forwarded query by `normalize_proxy_path`.
fn query_token(query: Option<&str>) -> Option<String> {
    let q = query?;
    for pair in q.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if (k == "t" || k == "access_token") && !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// One pooled, timeout-bounded HTTP client shared across ALL proxy requests.
/// Previously the handler built a fresh `reqwest::Client::new()` per call, which
/// forced a new TLS handshake (and connection) on every phone tap — slow and a
/// real source of "the connection feels laggy/unstable". A pooled client reuses
/// keep-alive connections; the timeouts ensure a slow/asleep cloud aborts in a
/// bounded time instead of hanging the phone for the full router wall-clock.
fn proxy_client() -> &'static reqwest::Client {
    static PROXY_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    PROXY_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(6))
            .timeout(std::time::Duration::from_secs(15))
            .pool_idle_timeout(std::time::Duration::from_secs(90))
            .pool_max_idle_per_host(8)
            .tcp_keepalive(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// `ANY /api/proxy/*path` — role-scoped reverse proxy to the cloud, injecting
/// the mother's `Authorization: Bearer`. Companions never see the credential.
async fn proxy_handler(
    AxumState(hub): AxumState<HubShared>,
    method: Method,
    Path(path): Path<String>,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // 1) Normalise + validate the captured path FIRST (C2). Reject traversal /
    //    control-byte / smuggling attempts with 400. Done before auth so the
    //    image-token fallback below can scope itself to photo renditions.
    let (fwd_path, lower_path) = match normalize_proxy_path(&path) {
        NormPath::Ok { path, lower } => (path, lower),
        NormPath::Rejected => {
            return (StatusCode::BAD_REQUEST, "invalid path").into_response();
        }
    };

    // 2) Authenticate the companion + resolve its role. A plain <img> tag cannot
    //    send the `X-Companion-Token` header, so for GET photo renditions
    //    (`photos/<id>/thumb|raw`) we ALSO accept the token from a `?t=` /
    //    `?access_token=` query param. Scoped to GET image renditions only so the
    //    credential-in-URL surface stays minimal; the param is stripped from the
    //    forwarded query (see `normalize_proxy_path`) so it never reaches the cloud.
    let is_photo_rendition = is_item_action(&lower_path, "photos", "thumb")
        || is_item_action(&lower_path, "photos", "raw");
    let role = match auth_role(&hub, &headers).await {
        Some(r) => Some(r),
        None if method == Method::GET && is_photo_rendition => match query_token(uri.query()) {
            Some(tok) => auth_role_token(&hub, &tok).await,
            None => None,
        },
        None => None,
    };
    let role = match role {
        Some(r) => r,
        None => return (StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
    };

    // 3) Second gate: hard-deny list on the normalised, lowercased path.
    if hard_denied(&lower_path) {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }

    // 4) Primary gate: positive, role-scoped allow-set (deny-by-default, C1).
    if !proxy_allowed(role, &method, &lower_path) {
        return (StatusCode::FORBIDDEN, "forbidden for role").into_response();
    }

    // 4b) Shape gate: the item-level appointments PATCH may ONLY carry the
    //     status-transition body. Anything else (reschedule payloads, extra
    //     fields, non-JSON) is rejected before it ever reaches the cloud.
    if method == Method::PATCH
        && is_single_item(&lower_path, "appointments")
        && !is_appointment_status_patch_body(&body)
    {
        return (StatusCode::FORBIDDEN, "nur Status-Übergänge erlaubt").into_response();
    }

    // 5) Resolve the mother's Bearer; without it, the proxy cannot speak. The
    //    hub auto-starts BEFORE the owner logs in, so this is a normal early
    //    state — answer with a clear German message the SPA can show.
    let bearer = {
        let inner = hub.inner.read().await;
        inner.bearer.clone()
    };
    if bearer.is_empty() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "Mutter noch nicht angemeldet",
        )
            .into_response();
    }

    // 6) Build + send the upstream request from the VALIDATED path only — never
    //    the raw capture. `fwd_path` is decode-safe and traversal-free.
    let url = format!("{CLOUD_BASE}/api/{fwd_path}");
    let client = proxy_client();
    let mut upstream = client.request(method.clone(), &url);

    // Forward a safe subset of headers (content-type, accept). Never forward the
    // companion token or any inbound Authorization — we inject our own.
    if let Some(ct) = headers.get(axum::http::header::CONTENT_TYPE) {
        if let Ok(v) = ct.to_str() {
            upstream = upstream.header(reqwest::header::CONTENT_TYPE, v);
        }
    }
    if let Some(acc) = headers.get(axum::http::header::ACCEPT) {
        if let Ok(v) = acc.to_str() {
            upstream = upstream.header(reqwest::header::ACCEPT, v);
        }
    }
    upstream = upstream.header(reqwest::header::AUTHORIZATION, format!("Bearer {bearer}"));

    if !body.is_empty() {
        upstream = upstream.body(body.to_vec());
    }

    match upstream.send().await {
        Ok(resp) => {
            let status = resp.status();
            // A cloud 401 means the MOTHER's session was rejected (stale/rotated
            // bearer) — NOT this phone's companion token. Forwarding the bare 401
            // would make the SPA log the phone out and demand a needless re-pair.
            // Remap to 503 so the phone instead shows "Hauptkasse nicht angemeldet"
            // and stays paired. (403 is left intact: it carries real per-action
            // denials — step-up, role, KYC — that the SPA surfaces verbatim.)
            if status.as_u16() == 401 {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Hauptkasse nicht angemeldet",
                )
                    .into_response();
            }
            let ct = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json")
                .to_string();
            let bytes = resp.bytes().await.unwrap_or_default();
            let code = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            (code, [(axum::http::header::CONTENT_TYPE, ct)], bytes).into_response()
        }
        Err(err) => {
            // Timeout vs other transport error — both surface to the phone as
            // "Keine Verbindung", but the distinct log helps diagnose a slow cloud.
            if err.is_timeout() {
                eprintln!("warehouse14-pos: companion proxy upstream TIMEOUT: {err}");
            } else {
                eprintln!("warehouse14-pos: companion proxy upstream error: {err}");
            }
            (StatusCode::BAD_GATEWAY, "upstream error").into_response()
        }
    }
}

/// Build the companion router with the shared hub state attached.
///
/// Layer order (outermost first): timeout → concurrency cap → body-size cap →
/// security headers (CSP on every response) → same-subnet guard → routes. The
/// subnet guard sits inside the header layer so even a 403-off-subnet response
/// still carries the CSP.
fn build_router(hub: HubShared) -> Router {
    Router::new()
        .route("/", get(serve_spa))
        .route("/app", get(serve_spa))
        .route("/app.html", get(serve_spa))
        .route("/app.js", get(serve_app_js))
        .route("/trust", get(trust_page_handler))
        .route(
            "/trust/warehouse14-ca.mobileconfig",
            get(trust_mobileconfig_handler),
        )
        .route("/health", get(health))
        .route("/pair", post(pair_handler))
        .route("/cart", get(cart_handler))
        .route("/ws", get(ws_handler))
        .route("/api/proxy/*path", any(proxy_handler))
        // Same-subnet guard (H3) — needs the hub state to read the mother IP.
        .layer(middleware::from_fn_with_state(hub.clone(), subnet_guard))
        // Strict CSP + hardening headers on every response (H2).
        .layer(middleware::from_fn(security_headers))
        // M2/M3/L2 — bound body size, in-flight concurrency, and wall-clock.
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES))
        .layer(ConcurrencyLimitLayer::new(MAX_CONCURRENT_REQUESTS))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::GATEWAY_TIMEOUT,
            REQUEST_TIMEOUT,
        ))
        .with_state(hub)
}

/// Bind the TCP listener, preferring [`COMPANION_PORT`] and falling back to an
/// OS-assigned ephemeral port if it is already taken.
async fn bind_listener() -> std::io::Result<(tokio::net::TcpListener, u16)> {
    let preferred = SocketAddr::from((Ipv4Addr::UNSPECIFIED, COMPANION_PORT));
    match tokio::net::TcpListener::bind(preferred).await {
        Ok(listener) => {
            let port = listener
                .local_addr()
                .map(|a| a.port())
                .unwrap_or(COMPANION_PORT);
            Ok((listener, port))
        }
        Err(_) => {
            let any = SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0));
            let listener = tokio::net::TcpListener::bind(any).await?;
            let port = listener.local_addr()?.port();
            Ok((listener, port))
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TLS (HTTPS) — secure context for the LAN hop (additive + fail-safe)
// ─────────────────────────────────────────────────────────────────────────────

/// A loaded/generated TLS identity: the cert chain + private key (both DER) and
/// the SHA-256 fingerprint (lowercase hex) of the leaf certificate.
struct TlsIdentity {
    cert_der: Vec<rustls::pki_types::CertificateDer<'static>>,
    key_der: rustls::pki_types::PrivateKeyDer<'static>,
    fingerprint: String,
}

/// SHA-256 of the DER-encoded leaf certificate, lowercase hex (colon-free). This
/// is the value the pairing screen shows so an operator can eyeball that the
/// phone trusted the right cert.
fn cert_fingerprint_hex(cert_der: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(cert_der);
    let digest = hasher.finalize();
    let mut s = String::with_capacity(64);
    for b in digest {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Root-CA material: the long-lived cert+key the hub uses to SIGN leaves, plus
/// the cert PEM the phone installs (and that goes into the served chain + the
/// `.mobileconfig`).
struct CaMaterial {
    cert: rcgen::Certificate,
    key: rcgen::KeyPair,
    cert_pem: String,
}

/// Write secret key material: `std::fs::write` then tighten to 0600 on unix.
fn write_secret(path: &FsPath, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Load the persisted private root CA, or generate + persist a fresh one. The CA
/// is long-lived and reused across restarts so a phone that installed it once
/// keeps trusting every rotated leaf. It is regenerated only if the files are
/// lost/corrupt (which forces phones to re-install the profile).
fn load_or_create_ca(dir: &FsPath) -> Result<CaMaterial, Box<dyn std::error::Error>> {
    use rcgen::KeyPair;

    let ca_cert_path = dir.join(TLS_CA_CERT_FILE);
    let ca_key_path = dir.join(TLS_CA_KEY_FILE);

    // Reuse a persisted CA: reload the KEY and reconstruct the in-memory signing
    // cert from the SAME deterministic params (`signed_by` only reads the
    // issuer's DN + key-id method + key_usages + key, and an identical key yields
    // an identical Subject-Key-Identifier — so leaves still chain to the ON-DISK
    // CA cert). The on-disk PEM is what phones install + we serve in the chain.
    if let (Ok(cert_pem), Ok(key_pem)) = (
        std::fs::read_to_string(&ca_cert_path),
        std::fs::read_to_string(&ca_key_path),
    ) {
        if let Ok(key) = KeyPair::from_pem(&key_pem) {
            if let Ok(cert) = ca_params()?.self_signed(&key) {
                return Ok(CaMaterial {
                    cert,
                    key,
                    cert_pem,
                });
            }
        }
        eprintln!(
            "warehouse14-pos: companion CA material unreadable; regenerating (phones must re-install)"
        );
    }

    let key = KeyPair::generate()?;
    let cert = ca_params()?.self_signed(&key)?;
    let cert_pem = cert.pem();

    std::fs::create_dir_all(dir)?;
    std::fs::write(&ca_cert_path, cert_pem.as_bytes())?;
    write_secret(&ca_key_path, key.serialize_pem().as_bytes())?;

    Ok(CaMaterial {
        cert,
        key,
        cert_pem,
    })
}

/// Deterministic root-CA params (same DN + key-usages every call) so a reloaded
/// CA signs leaves that still chain to the originally-persisted CA cert.
fn ca_params() -> Result<rcgen::CertificateParams, rcgen::Error> {
    use chrono::Datelike;
    use rcgen::{
        date_time_ymd, BasicConstraints, CertificateParams, DnType, IsCa, KeyUsagePurpose,
    };
    let mut params = CertificateParams::new(Vec::new())?;
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    params
        .distinguished_name
        .push(DnType::CommonName, "Warehouse14 Local CA");
    params
        .distinguished_name
        .push(DnType::OrganizationName, "Warehouse 14");
    let year = chrono::Utc::now().year();
    params.not_before = date_time_ymd(year - 1, 1, 1);
    params.not_after = date_time_ymd(year + TLS_CA_VALID_YEARS, 1, 1);
    Ok(params)
}

/// Generate a fresh **leaf** cert+key signed by `ca` for the given LAN IP, write
/// the full chain (leaf + CA) to `companion-tls.pem`, stamp the issue date, and
/// return the chain + key PEM. SANs: `warehouse14.local` + `localhost` always,
/// plus the LAN IPv4 when it is a real private address. `serverAuth` EKU +
/// ≤397-day validity so iOS accepts it once the CA is trusted.
fn generate_and_persist_cert(
    dir: &FsPath,
    lan: Ipv4Addr,
    ca: &CaMaterial,
) -> Result<(String, String), Box<dyn std::error::Error>> {
    use chrono::Datelike;
    use rcgen::{date_time_ymd, CertificateParams, DnType, ExtendedKeyUsagePurpose, KeyPair};

    let mut sans: Vec<String> = vec![TLS_SAN_LOCALHOST.to_string(), TLS_SAN_MDNS.to_string()];
    if is_private_lan_v4(lan) {
        sans.push(lan.to_string());
    }

    let mut params = CertificateParams::new(sans)?;
    params
        .distinguished_name
        .push(DnType::CommonName, TLS_SAN_MDNS);
    params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];

    // Day-precise ≤397-day window; `not_before` yesterday tolerates phone skew.
    let now = chrono::Utc::now();
    let start = now - chrono::Duration::days(1);
    let end = now + chrono::Duration::days(TLS_LEAF_VALID_DAYS);
    params.not_before = date_time_ymd(start.year(), start.month() as u8, start.day() as u8);
    params.not_after = date_time_ymd(end.year(), end.month() as u8, end.day() as u8);

    let key_pair = KeyPair::generate()?;
    let leaf = params.signed_by(&key_pair, &ca.cert, &ca.key)?;
    // Serve leaf THEN CA so the client builds the chain to the trusted root.
    let chain_pem = format!("{}{}", leaf.pem(), ca.cert_pem);
    let key_pem = key_pair.serialize_pem();

    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join(TLS_CERT_FILE), chain_pem.as_bytes())?;
    write_secret(&dir.join(TLS_KEY_FILE), key_pem.as_bytes())?;
    let _ = std::fs::write(dir.join(TLS_LEAF_ISSUED_FILE), now.to_rfc3339().as_bytes());

    Ok((chain_pem, key_pem))
}

/// Parse PEM cert + key strings into a [`TlsIdentity`] (DER chain + key +
/// fingerprint). Returns an error if the PEM is malformed or carries no key.
fn parse_tls_identity(
    cert_pem: &str,
    key_pem: &str,
) -> Result<TlsIdentity, Box<dyn std::error::Error>> {
    use rustls::pki_types::pem::PemObject;
    use rustls::pki_types::{CertificateDer, PrivateKeyDer};

    let cert_der: Vec<CertificateDer<'static>> =
        CertificateDer::pem_slice_iter(cert_pem.as_bytes()).collect::<Result<Vec<_>, _>>()?;
    if cert_der.is_empty() {
        return Err("no certificate in PEM".into());
    }
    let key_der = PrivateKeyDer::from_pem_slice(key_pem.as_bytes())?;
    let fingerprint = cert_fingerprint_hex(cert_der[0].as_ref());
    Ok(TlsIdentity {
        cert_der,
        key_der,
        fingerprint,
    })
}

/// Load the persisted cert+key for `lan`, generating + persisting a fresh one if
/// either file is missing/unreadable/unparseable. Returns the parsed identity
/// ready to feed rustls. Any hard failure (e.g. cannot write OR the freshly
/// generated PEM still won't parse) is returned so the caller falls back to
/// plain http.
fn load_or_create_tls_identity(
    dir: &FsPath,
    lan: Ipv4Addr,
) -> Result<TlsIdentity, Box<dyn std::error::Error>> {
    // The CA must exist first; the leaf is signed by it.
    let ca = load_or_create_ca(dir)?;
    let cert_path = dir.join(TLS_CERT_FILE);
    let key_path = dir.join(TLS_KEY_FILE);

    // Reuse the persisted leaf only if it parses AND is not near its ≤397-day
    // expiry. Otherwise re-issue under the same CA — the phone keeps trusting.
    if !leaf_needs_renewal(dir) {
        if let (Ok(cert_pem), Ok(key_pem)) = (
            std::fs::read_to_string(&cert_path),
            std::fs::read_to_string(&key_path),
        ) {
            match parse_tls_identity(&cert_pem, &key_pem) {
                Ok(id) => return Ok(id),
                Err(err) => {
                    eprintln!(
                        "warehouse14-pos: companion TLS leaf unreadable ({err}); regenerating"
                    );
                }
            }
        }
    }

    let (cert_pem, key_pem) = generate_and_persist_cert(dir, lan, &ca)?;
    parse_tls_identity(&cert_pem, &key_pem)
}

/// True when the persisted leaf is missing, undated, or within the renewal
/// window of its ≤397-day validity (so the hub re-issues it under the same CA).
fn leaf_needs_renewal(dir: &FsPath) -> bool {
    let Ok(issued) = std::fs::read_to_string(dir.join(TLS_LEAF_ISSUED_FILE)) else {
        return true; // never issued / undated
    };
    let Ok(issued) = chrono::DateTime::parse_from_rfc3339(issued.trim()) else {
        return true;
    };
    let age_days = (chrono::Utc::now() - issued.with_timezone(&chrono::Utc)).num_days();
    age_days >= (TLS_LEAF_VALID_DAYS - TLS_LEAF_RENEW_WITHIN_DAYS)
}

/// The root-CA cert PEM the phone must install (used by the `.mobileconfig`
/// route). Errors if the CA has not been created yet.
fn read_ca_cert_pem(dir: &FsPath) -> std::io::Result<String> {
    std::fs::read_to_string(dir.join(TLS_CA_CERT_FILE))
}

// Fixed payload UUIDs so re-downloading the profile cleanly REPLACES the same
// payloads on iOS (deduped by PayloadIdentifier; stable UUIDs keep it tidy).
const MC_PROFILE_UUID: &str = "7a3e1b40-1c2d-4e5f-8a9b-0c1d2e3f4a50";
const MC_CA_UUID: &str = "7a3e1b40-1c2d-4e5f-8a9b-0c1d2e3f4a51";
const MC_WEBCLIP_UUID: &str = "7a3e1b40-1c2d-4e5f-8a9b-0c1d2e3f4a52";

/// Strip the PEM armor + newlines, leaving the base64(DER) body a plist `<data>`
/// wants (a PEM body IS already base64 of the DER).
fn pem_to_der_b64(pem: &str) -> String {
    pem.lines()
        .filter(|l| !l.starts_with("-----"))
        .collect::<String>()
}

/// XML-escape the chars that matter inside a plist `<string>`.
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Build the iOS `.mobileconfig` that (1) installs the companion root CA — so the
/// hub's HTTPS becomes a TRUSTED secure context and the live camera/barcode work
/// — and (2) adds a full-screen Web Clip launching the SPA. `https_url` is the
/// stable mDNS URL the leaf is issued for (`https://warehouse14.local:8714`).
/// Unsigned (shows an "Unsigned" banner on install — harmless for the one shop
/// phone; the install + the one-time Certificate-Trust toggle still apply).
fn build_mobileconfig(ca_cert_pem: &str, https_url: &str) -> String {
    let der_b64 = pem_to_der_b64(ca_cert_pem);
    let url = xml_escape(https_url);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>com.apple.security.root</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>de.warehouse14.ca</string>
      <key>PayloadUUID</key><string>{ca_uuid}</string>
      <key>PayloadDisplayName</key><string>Warehouse 14 Local CA</string>
      <key>PayloadCertificateFileName</key><string>warehouse14-ca.cer</string>
      <key>PayloadContent</key>
      <data>{der_b64}</data>
    </dict>
    <dict>
      <key>PayloadType</key><string>com.apple.webClip.managed</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>de.warehouse14.webclip</string>
      <key>PayloadUUID</key><string>{wc_uuid}</string>
      <key>PayloadDisplayName</key><string>Warehouse 14</string>
      <key>Label</key><string>Warehouse 14</string>
      <key>URL</key><string>{url}</string>
      <key>IsRemovable</key><true/>
      <key>FullScreen</key><true/>
    </dict>
  </array>
  <key>PayloadDisplayName</key><string>Warehouse 14 — iPhone Einrichtung</string>
  <key>PayloadDescription</key><string>Installiert das Warehouse-14-Zertifikat und legt das App-Symbol an.</string>
  <key>PayloadIdentifier</key><string>de.warehouse14.profile</string>
  <key>PayloadOrganization</key><string>Warehouse 14</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>{prof_uuid}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
"#,
        ca_uuid = MC_CA_UUID,
        wc_uuid = MC_WEBCLIP_UUID,
        prof_uuid = MC_PROFILE_UUID,
    )
}

/// Process-wide install of the **ring** rustls crypto provider as the default,
/// done exactly once. We link rustls with the `ring` provider (NOT aws-lc-rs) to
/// match the existing reqwest stack; rustls still requires a process-default
/// provider to be installed before building a `ServerConfig` with the
/// non-explicit API. Idempotent: a second call is a harmless no-op.
fn ensure_crypto_provider() {
    use std::sync::Once;
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        // Ignore the error: it only means a provider was already installed
        // (e.g. by reqwest), which is exactly the state we want.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// Build a rustls [`ServerConfig`] from a TLS identity, pinned to the **ring**
/// provider. HTTP/1.1 only (the companion SPA + WS need no ALPN negotiation; the
/// hyper auto-builder still upgrades to WebSocket over HTTP/1.1).
fn build_rustls_config(
    identity: TlsIdentity,
) -> Result<rustls::ServerConfig, Box<dyn std::error::Error>> {
    ensure_crypto_provider();
    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(identity.cert_der, identity.key_der)?;
    Ok(config)
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC commands
// ─────────────────────────────────────────────────────────────────────────────

/// Stamp the live paired-device summary (count + sorted labels of every
/// non-idle-expired device) onto a snapshot before returning it over IPC.
async fn fill_paired(hub: &HubShared, info: &mut CompanionInfo) {
    let inner = hub.inner.read().await;
    let now = now_unix();
    let mut names: Vec<String> = inner
        .tokens
        .values()
        .filter(|e| !e.is_expired(now))
        .map(|e| e.label.clone())
        .collect();
    names.sort();
    info.paired_count = names.len();
    info.paired_devices = names;
}

/// Rotate a fresh single-use pairing code into an ALREADY-RUNNING hub (the
/// explicit "Geräte koppeln" action) and return the updated snapshot. Returns
/// `None` when the hub is not running. On CSPRNG failure the existing snapshot
/// is returned unchanged (no weak code is ever minted). Paired tokens are
/// deliberately KEPT — pairing is persistent now.
async fn rotate_pairing_code(state: &CompanionState) -> Option<CompanionInfo> {
    let mut info = {
        let guard = state.running.lock().unwrap_or_else(|p| p.into_inner());
        guard.as_ref().map(|r| r.info.clone())?
    };
    let Some(code) = fresh_pairing_code() else {
        eprintln!("warehouse14-pos: companion CSPRNG unavailable; keeping current code state");
        return Some(info);
    };
    {
        let mut inner = state.hub.inner.write().await;
        inner.pairing_code = code.clone();
        inner.code_issued_at = Some(Instant::now());
        inner.global_fail_count = 0;
        inner.pair_rate.clear();
    }
    info.pairing_code = code;
    {
        let mut guard = state.running.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(running) = guard.as_mut() {
            running.info = info.clone();
        }
    }
    Some(info)
}

/// Bind + start the hub server. `issue_code` controls whether a pairing code
/// is minted: the explicit "Geräte koppeln" start issues one; the launch-time
/// auto-start does NOT (no silent pairing window — persisted devices reconnect
/// with their tokens, new devices wait for the owner to open pairing).
///
/// Persisted pairings are LOADED here, never cleared — the 12 h wipe-on-start
/// is gone. On bind failure returns the `stopped()` snapshot (the POS keeps
/// working — companions just stay unavailable).
async fn start_hub(state: &CompanionState, issue_code: bool) -> CompanionInfo {
    // Fast path: already running → return the live snapshot.
    {
        let guard = state.running.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(running) = guard.as_ref() {
            return running.info.clone();
        }
    }

    let (listener, port) = match bind_listener().await {
        Ok(bound) => bound,
        Err(err) => {
            // Both the fixed port AND the ephemeral fallback failed (e.g. the
            // fallback also hit AddrInUse) — log and keep the POS alive.
            eprintln!("warehouse14-pos: companion server bind failed: {err}");
            return CompanionInfo::stopped();
        }
    };

    let ip = lan_ip();

    // Resolve the cert directory (the app data dir = the pairing store's parent)
    // and TRY to build a rustls config. This whole block is fallible: ANY error
    // (no data dir, cert gen/persist failure, unparseable PEM, rustls build
    // error) leaves `tls` = None and we serve plain http exactly as before — the
    // photo file-input fallback already works on http, so phone connectivity is
    // NEVER lost. On success a phone gets a secure context (live camera +
    // BarcodeDetector).
    let cert_dir: Option<PathBuf> = {
        let inner = state.hub.inner.read().await;
        inner
            .store_path
            .as_ref()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
    };
    let tls: Option<(rustls::ServerConfig, String)> = match &cert_dir {
        Some(dir) => match load_or_create_tls_identity(dir, ip) {
            Ok(identity) => {
                let fingerprint = identity.fingerprint.clone();
                match build_rustls_config(identity) {
                    Ok(cfg) => {
                        eprintln!(
                            "warehouse14-pos: companion TLS armed (HTTPS); cert sha256={fingerprint}"
                        );
                        Some((cfg, fingerprint))
                    }
                    Err(err) => {
                        eprintln!(
                            "warehouse14-pos: companion TLS config build failed ({err}); falling back to http"
                        );
                        None
                    }
                }
            }
            Err(err) => {
                eprintln!(
                    "warehouse14-pos: companion TLS cert load/gen failed ({err}); falling back to http"
                );
                None
            }
        },
        None => {
            eprintln!(
                "warehouse14-pos: companion data dir unresolved; serving plain http (no TLS)"
            );
            None
        }
    };

    let secure = tls.is_some();
    let scheme = if secure { "https" } else { "http" };
    let url = format!("{scheme}://{ip}:{port}");
    let tls_fingerprint = tls.as_ref().map(|(_, fp)| fp.clone());
    // CSPRNG-only pairing code. If the OS CSPRNG is unavailable we refuse to
    // start a PAIRABLE hub rather than issue a weak code; a code-less
    // auto-start is unaffected (it never mints).
    let pairing_code = if issue_code {
        match fresh_pairing_code() {
            Some(c) => c,
            None => {
                eprintln!("warehouse14-pos: companion CSPRNG unavailable; not starting hub");
                return CompanionInfo::stopped();
            }
        }
    } else {
        String::new()
    };
    let qr_svg = qr_svg_for(&url);
    // A2 — the iOS/Android onboarding entry point. IP-based (not the mDNS name)
    // so the FIRST contact works before the CA is trusted; the leaf carries the
    // IP SAN too. After the profile installs, the Web Clip uses warehouse14.local.
    let trust_url = format!("{url}/trust");
    let trust_qr_svg = qr_svg_for(&trust_url);

    // Arm shared hub state: pairing code (when issued), LAN IP (subnet guard),
    // reset rate buckets + the global failed-attempt lock. PERSISTENT PAIRING:
    // tokens are NOT cleared — the disk registry is merged in instead, so a
    // phone paired last week reconnects without touching the QR.
    {
        let mut inner = state.hub.inner.write().await;
        inner.pairing_code = pairing_code.clone();
        inner.code_issued_at = if pairing_code.is_empty() {
            None
        } else {
            Some(Instant::now())
        };
        inner.lan_ip = Some(ip);
        inner.global_fail_count = 0;
        inner.pair_rate.clear();
        load_store(&mut inner);
    }

    let info = CompanionInfo {
        running: true,
        url,
        port,
        pairing_code,
        qr_svg,
        paired_count: 0,
        paired_devices: Vec::new(),
        secure,
        tls_fingerprint,
        trust_url,
        trust_qr_svg,
    };

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let app = build_router(state.hub.clone());
    // `into_make_service_with_connect_info` surfaces the real TCP peer addr to
    // handlers via `ConnectInfo<SocketAddr>` — required by the per-IP rate limit
    // (H1) and the same-subnet guard (H3). Shared by BOTH the http + https paths.
    let make = app.into_make_service_with_connect_info::<SocketAddr>();

    let task = match tls {
        // ── HTTPS path (secure context) ──────────────────────────────────────
        // Serve the SAME router over rustls via axum-server, reusing the
        // already-bound listener (keeps the port-fallback behaviour). Graceful
        // shutdown rides the existing `oneshot`: when `companion_stop` sends on
        // it, we trigger axum-server's `Handle::graceful_shutdown` — so the stop
        // path in `companion_stop` is identical for http + https.
        Some((cfg, _fingerprint)) => {
            // Hand the bound socket to axum-server as a std listener. A failure
            // here (extremely unlikely — it's an already-bound fd) is logged and
            // the task exits, leaving the POS alive; the snapshot still reports
            // running until the next status read, which is acceptable.
            match listener.into_std() {
                Ok(std_listener) => {
                    // axum-server drives the accept loop itself; the std listener
                    // must be non-blocking under tokio.
                    let _ = std_listener.set_nonblocking(true);
                    let config = axum_server::tls_rustls::RustlsConfig::from_config(
                        std::sync::Arc::new(cfg),
                    );
                    let handle = axum_server::Handle::new();
                    let shutdown_handle = handle.clone();
                    tokio::spawn(async move {
                        // Wait for the stop signal, then graceful-shutdown the
                        // TLS server (no drain timeout — match the http path's
                        // immediate intent).
                        let _ = shutdown_rx.await;
                        shutdown_handle.graceful_shutdown(None);
                    });
                    tokio::spawn(async move {
                        let server =
                            axum_server::from_tcp_rustls(std_listener, config).handle(handle);
                        if let Err(err) = server.serve(make).await {
                            eprintln!(
                                "warehouse14-pos: companion HTTPS server exited with error: {err}"
                            );
                        }
                    })
                }
                Err(err) => {
                    eprintln!(
                        "warehouse14-pos: companion listener into_std failed ({err}); cannot start TLS"
                    );
                    return CompanionInfo::stopped();
                }
            }
        }
        // ── Plain-http fallback (unchanged) ──────────────────────────────────
        None => tokio::spawn(async move {
            let server = axum::serve(listener, make).with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            });
            if let Err(err) = server.await {
                eprintln!("warehouse14-pos: companion server exited with error: {err}");
            }
        }),
    };

    let snapshot = info.clone();
    {
        let mut guard = state.running.lock().unwrap_or_else(|p| p.into_inner());
        // Re-check under the lock to avoid a double-start race.
        if let Some(running) = guard.as_ref() {
            drop(shutdown_tx);
            task.abort();
            return running.info.clone();
        }
        *guard = Some(RunningCompanion {
            info,
            shutdown: shutdown_tx,
            task,
        });
    }
    // The hub is bound and serving — keep the mother awake so phones stay linked.
    power_hold::acquire();

    snapshot
}

/// Launch-time auto-start (called from `lib.rs` `.setup()`): set the pairing
/// store path under the app data dir, then bring the hub up WITHOUT a pairing
/// code. Idempotent and fail-safe — a bind failure (port races, AddrInUse on
/// both binds) is logged and never blocks POS startup. The mother's Bearer
/// arrives later via the normal `companion_set_auth` flow; until then the
/// proxy answers 503 "Mutter noch nicht angemeldet".
pub async fn companion_autostart(state: CompanionState, data_dir: Option<PathBuf>) {
    match data_dir {
        Some(dir) => {
            let mut inner = state.hub.inner.write().await;
            inner.store_path = Some(dir.join(PAIRING_STORE_FILE));
        }
        None => {
            eprintln!(
                "warehouse14-pos: app data dir unresolved; companion pairing will not persist"
            );
        }
    }
    let mut info = start_hub(&state, false).await;
    if info.running {
        fill_paired(&state.hub, &mut info).await;
        eprintln!(
            "warehouse14-pos: companion hub auto-started at {} ({} paired device(s) restored)",
            info.url, info.paired_count
        );
    } else {
        eprintln!("warehouse14-pos: companion hub auto-start failed (see bind error above)");
    }
}

/// Start the companion hub (the explicit "Geräte koppeln" action). Idempotent:
/// when the hub is already running (normal case — it auto-starts at launch)
/// this ROTATES a fresh single-use pairing code instead of returning the
/// stale/spent one, so the pairing dialog always shows a live code. On bind
/// failure returns the `stopped()` snapshot (the POS keeps working).
#[tauri::command]
pub async fn companion_start(state: State<'_, CompanionState>) -> Result<CompanionInfo, ()> {
    let mut info = match rotate_pairing_code(&state).await {
        Some(info) => info,
        None => start_hub(&state, true).await,
    };
    fill_paired(&state.hub, &mut info).await;
    Ok(info)
}

/// Stop the companion hub. Idempotent — a no-op when nothing is running.
#[tauri::command]
pub async fn companion_stop(state: State<'_, CompanionState>) -> Result<(), ()> {
    let running = {
        let mut guard = state.running.lock().unwrap_or_else(|p| p.into_inner());
        guard.take()
    };
    if let Some(running) = running {
        let _ = running.shutdown.send(());
        let _ = running.task.await;
        // Hub stopped → drop the keep-awake hold so the mother can sleep normally.
        power_hold::release();
    }
    // Reset the pairing window + per-session counters. Paired tokens are
    // deliberately KEPT (and flushed if dirty): pairing is persistent — a
    // stop/start cycle must not evict the phone. Idle eviction (30 days)
    // remains the only way a device falls off.
    {
        let mut inner = state.hub.inner.write().await;
        if inner.store_dirty {
            persist_now(&mut inner);
        }
        inner.pairing_code.clear();
        inner.code_issued_at = None;
        inner.lan_ip = None;
        inner.global_fail_count = 0;
        inner.pair_rate.clear();
    }
    Ok(())
}

/// Return the current companion snapshot (running or stopped), including the
/// live paired-device summary (count + labels) for the Einstellungen UI.
#[tauri::command]
pub async fn companion_status(state: State<'_, CompanionState>) -> Result<CompanionInfo, ()> {
    let mut info = {
        let guard = state.running.lock().unwrap_or_else(|p| p.into_inner());
        guard
            .as_ref()
            .map(|r| r.info.clone())
            .unwrap_or_else(CompanionInfo::stopped)
    };
    fill_paired(&state.hub, &mut info).await;
    Ok(info)
}

/// Store the mother's current cloud session Bearer so the proxy can inject it.
/// The React layer calls this on login and on mount. Passing an empty string
/// effectively disarms the proxy (it returns 503 until re-armed).
#[tauri::command]
pub async fn companion_set_auth(
    state: State<'_, CompanionState>,
    bearer: String,
) -> Result<(), ()> {
    let mut inner = state.hub.inner.write().await;
    inner.bearer = bearer;
    Ok(())
}

/// Publish the latest cart snapshot (raw JSON string) for `GET /cart` AND the
/// realtime `GET /ws` feed — drives the customer-display companion. The shape is
/// whatever the JS publishes; the SPA tolerates the common fields (`items[]`,
/// `totalEur`).
///
/// Two effects: (1) store the snapshot so a fresh `GET /cart` poll or a new
/// `/ws` connect paints immediately; (2) broadcast it so every already-connected
/// display re-renders live. The broadcast is best-effort — `send` only errors
/// when there are zero subscribers, which is the normal idle case, so we ignore
/// it.
#[tauri::command]
pub async fn companion_publish_cart(
    state: State<'_, CompanionState>,
    cart_json: String,
) -> Result<(), ()> {
    {
        let mut inner = state.hub.inner.write().await;
        inner.cart_json = Some(cart_json.clone());
    }
    // Fan out to live displays. `Err` here means "no subscribers" — fine.
    let _ = state.hub.cart_tx.send(cart_json);
    Ok(())
}

/// Send a POS→phone command to a paired companion (Phase B). `device_id` is the
/// target phone's id (SHA-256 of its token, as shown in the registry) or `"*"`
/// to broadcast to every command socket. `action` is the command payload, e.g.
/// `{"type":"start-scan"}` or `{"type":"focus-field","field":"sku"}`.
///
/// Mirrors `companion_publish_cart`: best-effort broadcast (a `send` error just
/// means no command sockets are connected — the normal idle case).
#[tauri::command]
pub async fn companion_send_command(
    state: State<'_, CompanionState>,
    device_id: String,
    action: serde_json::Value,
) -> Result<(), ()> {
    let payload = serde_json::json!({ "deviceId": device_id, "action": action }).to_string();
    let _ = state.hub.cmd_tx.send(payload);
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Phase B: POS-controllable scanner command path ───────────────────────

    #[test]
    fn command_routes_to_the_addressed_device_only() {
        let cmd = serde_json::json!({ "deviceId": "abc123", "action": { "type": "start-scan" } })
            .to_string();
        assert!(command_is_for_device(&cmd, "abc123"), "addressed device receives it");
        assert!(!command_is_for_device(&cmd, "other"), "a different device is skipped");
    }

    #[test]
    fn wildcard_command_fans_out_to_every_device() {
        let cmd = serde_json::json!({ "deviceId": "*", "action": { "type": "stop-scan" } })
            .to_string();
        assert!(command_is_for_device(&cmd, "abc123"));
        assert!(command_is_for_device(&cmd, "zzz"));
    }

    #[test]
    fn malformed_or_unaddressed_command_reaches_no_device() {
        assert!(!command_is_for_device("not json", "abc"));
        assert!(!command_is_for_device(r#"{"action":{}}"#, "abc")); // no deviceId
    }

    #[test]
    fn scan_result_frame_yields_the_code_others_yield_none() {
        assert_eq!(
            scan_code_from_frame(r#"{"type":"scan-result","code":"4001234"}"#).as_deref(),
            Some("4001234"),
        );
        // Wrong type, missing/empty/non-string code, and garbage are all rejected —
        // a phone can drive NOTHING but a scan through the command socket.
        assert_eq!(scan_code_from_frame(r#"{"type":"start-scan","code":"x"}"#), None);
        assert_eq!(scan_code_from_frame(r#"{"type":"scan-result"}"#), None);
        assert_eq!(scan_code_from_frame(r#"{"type":"scan-result","code":""}"#), None);
        assert_eq!(scan_code_from_frame(r#"{"type":"scan-result","code":123}"#), None);
        assert_eq!(scan_code_from_frame("}{"), None);
    }

    #[tokio::test]
    async fn send_command_broadcasts_to_a_subscribed_command_socket() {
        // The IPC fans a command onto cmd_tx; a (would-be command-socket) subscriber
        // receives the exact {deviceId, action} envelope the phone filters on.
        let hub = HubShared::default();
        let mut rx = hub.cmd_tx.subscribe();
        let payload =
            serde_json::json!({ "deviceId": "dev-1", "action": { "type": "focus-field", "field": "sku" } })
                .to_string();
        hub.cmd_tx.send(payload.clone()).expect("a live subscriber exists");
        let got = rx.recv().await.expect("delivered");
        assert!(command_is_for_device(&got, "dev-1"));
        let v: serde_json::Value = serde_json::from_str(&got).unwrap();
        assert_eq!(v["action"]["type"], "focus-field");
        assert_eq!(v["action"]["field"], "sku");
    }

    // ── Proxy allow-list: WAREHOUSE Termine grants ───────────────────────────

    #[test]
    fn warehouse_can_read_create_and_status_patch_appointments() {
        let r = Role::Warehouse;
        // Reads: list, item, (the ?from/to query is stripped before matching).
        assert!(proxy_allowed(r, &Method::GET, "appointments"));
        assert!(proxy_allowed(r, &Method::GET, "appointments/0d9f3a1e"));
        // Create.
        assert!(proxy_allowed(r, &Method::POST, "appointments"));
        // Item-level status PATCH (shape pinned separately by the body gate).
        assert!(proxy_allowed(r, &Method::PATCH, "appointments/0d9f3a1e"));
        // NOT a deeper sub-action, NOT collection-level PATCH, NOT DELETE.
        assert!(!proxy_allowed(
            r,
            &Method::PATCH,
            "appointments/0d9f3a1e/reschedule"
        ));
        assert!(!proxy_allowed(r, &Method::PATCH, "appointments"));
        assert!(!proxy_allowed(r, &Method::DELETE, "appointments/0d9f3a1e"));
        assert!(!proxy_allowed(r, &Method::PUT, "appointments/0d9f3a1e"));
    }

    #[test]
    fn warehouse_can_read_customers_but_never_write_them() {
        let r = Role::Warehouse;
        assert!(proxy_allowed(r, &Method::GET, "customers"));
        assert!(proxy_allowed(r, &Method::GET, "customers/42"));
        assert!(!proxy_allowed(r, &Method::POST, "customers"));
        assert!(!proxy_allowed(r, &Method::PATCH, "customers/42"));
        assert!(!proxy_allowed(r, &Method::PUT, "customers/42"));
    }

    // ── Proxy allow-list: ZWEITKASSE gets appointment READS only ────────────

    #[test]
    fn cashier_gets_appointment_reads_but_no_writes() {
        let r = Role::Cashier;
        assert!(proxy_allowed(r, &Method::GET, "appointments"));
        assert!(proxy_allowed(r, &Method::GET, "appointments/0d9f3a1e"));
        assert!(!proxy_allowed(r, &Method::POST, "appointments"));
        assert!(!proxy_allowed(r, &Method::PATCH, "appointments/0d9f3a1e"));
    }

    // ── Proxy allow-list: ZWEITKASSE may reserve/release (cart holds) ───────

    #[test]
    fn cashier_can_reserve_and_release_inventory() {
        let r = Role::Cashier;
        // The real till needs to hold a unique item under its cart and let it go.
        assert!(proxy_allowed(r, &Method::POST, "inventory/reserve"));
        assert!(proxy_allowed(r, &Method::POST, "inventory/release"));
        // But NOT the step-up-gated stock mutation, nor any other inventory verb.
        assert!(!proxy_allowed(r, &Method::POST, "inventory/adjust"));
        assert!(!proxy_allowed(r, &Method::GET, "inventory/reserve"));
        assert!(!proxy_allowed(r, &Method::PATCH, "inventory/reserve"));
        // The warehouse role does NOT gain the cart reserve/release verbs.
        assert!(!proxy_allowed(
            Role::Warehouse,
            &Method::POST,
            "inventory/reserve"
        ));
        assert!(!proxy_allowed(
            Role::Warehouse,
            &Method::POST,
            "inventory/release"
        ));
        // Display gets nothing here.
        assert!(!proxy_allowed(
            Role::Display,
            &Method::POST,
            "inventory/reserve"
        ));
    }

    #[test]
    fn cashier_gets_public_photo_renditions_for_tiles() {
        let r = Role::Cashier;
        // The till's catalog tiles render the same id-scoped thumbnails as Lager.
        assert!(proxy_allowed(r, &Method::GET, "photos/0d9f3a1e/thumb"));
        assert!(proxy_allowed(r, &Method::GET, "photos/0d9f3a1e/raw"));
        // …but never the photo workflow lists or any photo write.
        assert!(!proxy_allowed(r, &Method::GET, "photos/unassigned"));
        assert!(!proxy_allowed(r, &Method::POST, "photos"));
        assert!(!proxy_allowed(r, &Method::PATCH, "photos/0d9f3a1e/primary"));
    }

    #[test]
    fn query_token_reads_image_auth_fallback() {
        // The <img> auth fallback pulls the token from `t=` / `access_token=`.
        assert_eq!(query_token(Some("t=abc123")), Some("abc123".to_string()));
        assert_eq!(
            query_token(Some("foo=1&access_token=xyz&bar=2")),
            Some("xyz".to_string())
        );
        // No token param, an empty value, or no query at all → None.
        assert_eq!(query_token(Some("foo=1&bar=2")), None);
        assert_eq!(query_token(Some("t=")), None);
        assert_eq!(query_token(None), None);
    }

    // ── Proxy allow-list: WAREHOUSE may re-shelve via the no-step-up route ──

    #[test]
    fn warehouse_can_relocate_a_product_but_not_other_actions() {
        let r = Role::Warehouse;
        // The dedicated LOCATION-ONLY move (no step-up) — exactly three segments.
        assert!(proxy_allowed(
            r,
            &Method::POST,
            "products/0d9f3a1e/relocate"
        ));
        // The existing stock-adjust + photo POSTs still pass (regression guard).
        assert!(proxy_allowed(
            r,
            &Method::POST,
            "products/0d9f3a1e/inventory-adjustment"
        ));
        assert!(proxy_allowed(r, &Method::POST, "products/0d9f3a1e/photos"));
        // The POST grant is tight: NOT a relocate on the collection, NOT an
        // empty-id shape, NOT a deeper sub-path. (A GET on this path rides the
        // broad product-read prefix and is harmless — the cloud route is
        // POST-only — so it is intentionally NOT asserted here.)
        assert!(!proxy_allowed(r, &Method::POST, "products/relocate"));
        assert!(!proxy_allowed(r, &Method::POST, "products//relocate"));
        assert!(!proxy_allowed(
            r,
            &Method::POST,
            "products/0d9f3a1e/relocate/now"
        ));
        assert!(!proxy_allowed(
            r,
            &Method::PUT,
            "products/0d9f3a1e/relocate"
        ));
        // Other roles never gain product relocate.
        assert!(!proxy_allowed(
            Role::Cashier,
            &Method::POST,
            "products/0d9f3a1e/relocate"
        ));
        assert!(!proxy_allowed(
            Role::Display,
            &Method::POST,
            "products/0d9f3a1e/relocate"
        ));
    }

    // ── Proxy allow-list: KUNDENANZEIGE gets nothing new ─────────────────────

    #[test]
    fn display_gets_no_appointments_and_no_customers() {
        let r = Role::Display;
        assert!(!proxy_allowed(r, &Method::GET, "appointments"));
        assert!(!proxy_allowed(r, &Method::POST, "appointments"));
        assert!(!proxy_allowed(r, &Method::GET, "customers"));
    }

    // ── Money / fiscal paths stay hard-denied for every companion role ──────

    #[test]
    fn money_and_fiscal_paths_stay_denied_for_warehouse() {
        let r = Role::Warehouse;
        assert!(!proxy_allowed(r, &Method::POST, "transactions"));
        assert!(!proxy_allowed(r, &Method::POST, "transactions/finalize"));
        assert!(!proxy_allowed(r, &Method::GET, "transactions"));
        assert!(!proxy_allowed(r, &Method::GET, "closings"));
        // Belt-and-braces deny list still bites regardless of role rules.
        assert!(hard_denied("transactions/abc/storno"));
        assert!(hard_denied("ankauf/payout"));
        assert!(hard_denied("tse/export"));
        assert!(hard_denied("export/datev"));
        // The new namespaces are NOT hard-denied (sanity).
        assert!(!hard_denied("appointments"));
        assert!(!hard_denied("appointments/0d9f3a1e"));
        assert!(!hard_denied("customers/42"));
    }

    // ── Status-transition PATCH body shape ──────────────────────────────────

    #[test]
    fn appointment_patch_body_accepts_only_the_status_shape() {
        // The plain transition.
        assert!(is_appointment_status_patch_body(
            br#"{"status":"CHECKED_IN"}"#
        ));
        // With the two optional string fields from the live contract.
        assert!(is_appointment_status_patch_body(
            br#"{"status":"CANCELLED","cancellationReason":"Kunde abgesagt"}"#
        ));
        assert!(is_appointment_status_patch_body(
            br#"{"status":"COMPLETED","staffNotes":"Goldring abgeholt"}"#
        ));
        // Unknown status value.
        assert!(!is_appointment_status_patch_body(
            br#"{"status":"SCHEDULED"}"#
        ));
        // Missing status.
        assert!(!is_appointment_status_patch_body(br#"{"staffNotes":"x"}"#));
        // Extra / unexpected keys (e.g. a smuggled reschedule).
        assert!(!is_appointment_status_patch_body(
            br#"{"status":"CONFIRMED","startsAt":"2026-06-11T10:00:00Z"}"#
        ));
        // Wrong types and non-objects.
        assert!(!is_appointment_status_patch_body(br#"{"status":7}"#));
        assert!(!is_appointment_status_patch_body(br#"[]"#));
        assert!(!is_appointment_status_patch_body(b"not json"));
        assert!(!is_appointment_status_patch_body(
            br#"{"status":"CONFIRMED","staffNotes":42}"#
        ));
    }

    // ── Path-shape helper ────────────────────────────────────────────────────

    #[test]
    fn single_item_matcher_is_exactly_two_segments() {
        assert!(is_single_item("appointments/abc", "appointments"));
        assert!(!is_single_item("appointments", "appointments"));
        assert!(!is_single_item("appointments//", "appointments"));
        assert!(!is_single_item("appointments/abc/status", "appointments"));
        assert!(!is_single_item("customers/abc", "appointments"));
    }

    // ── Token hashing ────────────────────────────────────────────────────────

    #[test]
    fn token_hash_is_stable_sha256_hex() {
        let h = token_hash_hex("abc");
        // SHA-256("abc") — well-known vector.
        assert_eq!(
            h,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(h.len(), 64);
        assert_ne!(token_hash_hex("abd"), h);
    }

    // ── Idle expiry ──────────────────────────────────────────────────────────

    #[test]
    fn entries_expire_on_idle_not_age() {
        let now = 1_750_000_000u64;
        // Paired ages ago but USED recently → alive (the old 12 h TTL is gone).
        let active = CompanionEntry {
            role: Role::Warehouse,
            label: "Lager-Gerät".into(),
            created_unix: now - 90 * 24 * 60 * 60,
            last_seen_unix: now - 60,
        };
        assert!(!active.is_expired(now));
        // Untouched for 31 days → evicted.
        let idle = CompanionEntry {
            role: Role::Warehouse,
            label: "Lager-Gerät".into(),
            created_unix: now - 90 * 24 * 60 * 60,
            last_seen_unix: now - 31 * 24 * 60 * 60,
        };
        assert!(idle.is_expired(now));
    }

    // ── Persistence round-trip ───────────────────────────────────────────────

    #[test]
    fn pairing_store_roundtrips_and_drops_idle_devices_on_load() {
        let path = std::env::temp_dir().join(format!(
            "w14-companion-pairing-test-{}.json",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);

        let now = now_unix();
        let mut writer = HubInner::default();
        writer.store_path = Some(path.clone());
        writer.tokens.insert(
            token_hash_hex("fresh-token"),
            CompanionEntry {
                role: Role::Warehouse,
                label: "iPhone Basel".into(),
                created_unix: now - 1000,
                last_seen_unix: now - 10,
            },
        );
        writer.tokens.insert(
            token_hash_hex("stale-token"),
            CompanionEntry {
                role: Role::Display,
                label: "Altes iPad".into(),
                created_unix: now - 40 * 24 * 60 * 60,
                last_seen_unix: now - 31 * 24 * 60 * 60,
            },
        );
        persist_now(&mut writer);
        assert!(!writer.store_dirty);
        assert!(path.exists());

        // The file must contain hashes only — never a plaintext token.
        let raw = std::fs::read_to_string(&path).expect("store readable");
        assert!(!raw.contains("fresh-token"));
        assert!(raw.contains(&token_hash_hex("fresh-token")));

        // Fresh process: load → only the active device survives.
        let mut reader = HubInner::default();
        reader.store_path = Some(path.clone());
        load_store(&mut reader);
        assert_eq!(reader.tokens.len(), 1);
        let entry = reader
            .tokens
            .get(&token_hash_hex("fresh-token"))
            .expect("active device restored");
        assert_eq!(entry.role, Role::Warehouse);
        assert_eq!(entry.label, "iPhone Basel");

        let _ = std::fs::remove_file(&path);
    }

    // ── Label sanitising ─────────────────────────────────────────────────────

    #[test]
    fn labels_are_sanitised_with_german_role_fallback() {
        assert_eq!(sanitize_label("", Role::Warehouse), "Lager-Gerät");
        assert_eq!(sanitize_label("   ", Role::Cashier), "Zweitkasse");
        assert_eq!(sanitize_label("\u{0007}", Role::Display), "Kundenanzeige");
        assert_eq!(
            sanitize_label(" iPhone Basel ", Role::Warehouse),
            "iPhone Basel"
        );
        // Capped at 40 chars.
        let long = "x".repeat(120);
        assert_eq!(sanitize_label(&long, Role::Warehouse).len(), 40);
    }

    // ── TLS: cert generation, fingerprint, persistence, fallback selection ───

    /// A unique temp dir for one TLS test, removed first to start clean.
    fn fresh_tls_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "w14-companion-tls-test-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn cert_generation_persists_files_and_yields_a_stable_fingerprint() {
        let dir = fresh_tls_dir("gen");
        let lan: Ipv4Addr = "192.168.1.42".parse().unwrap();

        // First create: writes both PEM files and a usable identity.
        let id1 = load_or_create_tls_identity(&dir, lan).expect("identity generated");
        assert!(dir.join(TLS_CERT_FILE).exists(), "cert PEM persisted");
        assert!(dir.join(TLS_KEY_FILE).exists(), "key PEM persisted");
        assert_eq!(id1.fingerprint.len(), 64, "sha256 hex is 64 chars");
        assert!(
            id1.fingerprint.chars().all(|c| c.is_ascii_hexdigit()),
            "fingerprint is lowercase hex"
        );
        assert!(!id1.cert_der.is_empty(), "at least one cert in chain");

        // The persisted cert+key must build a rustls config (ring provider).
        build_rustls_config(id1).expect("rustls config builds from the cert");

        // Second load reuses the SAME files → IDENTICAL fingerprint (a phone that
        // trusted it once stays trusted across restarts).
        let id2 = load_or_create_tls_identity(&dir, lan).expect("identity reloaded");
        // Re-read fingerprint independently from the persisted cert bytes.
        let reread = cert_fingerprint_hex(id2.cert_der[0].as_ref());
        assert_eq!(reread, id2.fingerprint);

        // Compare against a fresh parse of the on-disk PEM for stability.
        let cert_pem = std::fs::read_to_string(dir.join(TLS_CERT_FILE)).unwrap();
        let key_pem = std::fs::read_to_string(dir.join(TLS_KEY_FILE)).unwrap();
        let reparsed = parse_tls_identity(&cert_pem, &key_pem).expect("reparse");
        assert_eq!(
            reparsed.fingerprint, id2.fingerprint,
            "fingerprint stable across reload"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn leaf_chains_to_the_ca() {
        let dir = fresh_tls_dir("chain");
        let lan: Ipv4Addr = "192.168.1.42".parse().unwrap();
        let id = load_or_create_tls_identity(&dir, lan).expect("identity");

        // The served material is the leaf PLUS the CA, so a client can build the
        // chain to the installed root.
        assert_eq!(id.cert_der.len(), 2, "serves leaf + CA chain");
        assert!(dir.join(TLS_CA_CERT_FILE).exists(), "CA cert persisted");
        assert!(dir.join(TLS_CA_KEY_FILE).exists(), "CA key persisted");

        // Cryptographic proof: the leaf verifies against the persisted CA. Skip
        // gracefully where openssl is not on PATH (e.g. a bare Windows runner).
        let chain = std::fs::read_to_string(dir.join(TLS_CERT_FILE)).unwrap();
        let leaf_pem = chain.split("-----END CERTIFICATE-----").next().unwrap();
        let leaf_path = dir.join("leaf-only.pem");
        std::fs::write(&leaf_path, format!("{leaf_pem}-----END CERTIFICATE-----\n")).unwrap();
        match std::process::Command::new("openssl")
            .arg("verify")
            .arg("-CAfile")
            .arg(dir.join(TLS_CA_CERT_FILE))
            .arg(&leaf_path)
            .output()
        {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                assert!(
                    out.status.success() && stdout.contains("OK"),
                    "openssl verify failed: {stdout} {}",
                    String::from_utf8_lossy(&out.stderr)
                );
            }
            Err(_) => eprintln!("openssl not on PATH — skipping leaf↔CA crypto verify"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mobileconfig_embeds_ca_and_webclip() {
        let dir = fresh_tls_dir("mc");
        let lan: Ipv4Addr = "192.168.1.42".parse().unwrap();
        let _ = load_or_create_tls_identity(&dir, lan).expect("identity");
        let ca = read_ca_cert_pem(&dir).expect("ca pem");
        let mc = build_mobileconfig(&ca, "https://warehouse14.local:8714");

        assert!(mc.starts_with("<?xml"), "is a plist");
        assert!(mc.contains("</plist>"));
        assert!(mc.contains("com.apple.security.root"), "installs the CA");
        assert!(
            mc.contains("com.apple.webClip.managed"),
            "adds the web clip"
        );
        assert!(
            mc.contains("https://warehouse14.local:8714"),
            "web clip URL"
        );

        // The embedded <data> is clean base64(DER) — no PEM armor, no newlines.
        let der_b64 = pem_to_der_b64(&ca);
        assert!(!der_b64.is_empty());
        assert!(!der_b64.contains("-----") && !der_b64.contains('\n'));
        assert!(mc.contains(&der_b64), "embeds the CA DER");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cert_fingerprint_is_sha256_of_der() {
        // Known vector: sha256 of the bytes [0xAB, 0xCD] — guards the hex helper.
        let fp = cert_fingerprint_hex(&[0xAB, 0xCD]);
        assert_eq!(
            fp,
            "123d4c7ef2d1600a1b3a0f6addc60a10f05a3495c9409f2ecbf4cc095d000a6b"
        );
        // Length-correct, stable, and differs on different input.
        assert_eq!(fp.len(), 64);
        assert_eq!(cert_fingerprint_hex(&[0xAB, 0xCD]), fp);
        assert_ne!(cert_fingerprint_hex(&[0xAB, 0xCE]), fp);
    }

    #[test]
    fn corrupt_pem_is_rejected_so_the_caller_falls_back() {
        // A forced cert error: garbage PEM must NOT parse into an identity. This
        // is exactly the condition `start_hub` treats as "TLS unavailable →
        // serve plain http" (the fallback path), so a parse failure here proves
        // the http fallback is selected on a bad/forced cert.
        assert!(
            parse_tls_identity("not a pem", "also not a pem").is_err(),
            "garbage PEM must be rejected (→ http fallback)"
        );
        // A real cert PEM but an EMPTY key is likewise rejected (a half-written
        // key file would otherwise sneak a broken config into rustls).
        let dir = fresh_tls_dir("corrupt");
        let lan: Ipv4Addr = "10.0.0.5".parse().unwrap();
        load_or_create_tls_identity(&dir, lan).expect("baseline cert");
        let cert_pem = std::fs::read_to_string(dir.join(TLS_CERT_FILE)).unwrap();
        assert!(
            parse_tls_identity(&cert_pem, "").is_err(),
            "missing key must be rejected (→ http fallback)"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn loopback_lan_omits_the_ip_san_but_still_generates() {
        // Offline / link-down: lan_ip() returns loopback. The cert must still
        // generate (localhost + warehouse14.local SANs) so TLS is available for
        // the on-box webview; the IP SAN is simply skipped.
        let dir = fresh_tls_dir("loopback");
        let id = load_or_create_tls_identity(&dir, Ipv4Addr::LOCALHOST)
            .expect("cert still generates without a LAN IP");
        assert_eq!(id.fingerprint.len(), 64);
        build_rustls_config(id).expect("config builds even without an IP SAN");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
