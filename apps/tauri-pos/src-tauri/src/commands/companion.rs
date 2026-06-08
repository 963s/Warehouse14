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
//!   authenticates its token (query param), then the mother pushes the cart
//!   JSON on connect and on every `companion_publish_cart` via a
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
//! rate-limited on the *real* TCP peer IP; the token is hex-encoded and
//! TTL-bounded. The pairing code is compared with `subtle::ConstantTimeEq` to
//! avoid a timing oracle. If the CSPRNG fails we REFUSE to mint (503) rather
//! than fall back to a weak RNG.
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
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Path, Query, State as AxumState,
    },
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use tauri::State;
use tokio::sync::{broadcast, oneshot, RwLock};
use tokio::task::JoinHandle;
use tower::limit::ConcurrencyLimitLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::timeout::TimeoutLayer;

/// Fixed LAN port for the companion hub. Picked from the IANA dynamic range so
/// it is unlikely to collide; falls back to an OS-assigned ephemeral port if
/// 8714 is already bound.
const COMPANION_PORT: u16 = 8714;

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

/// Companion-token lifetime. A token older than this is evicted on use (and by
/// the periodic map sweep), forcing a re-pair. Belt for the H3 TTL ask.
const TOKEN_TTL: Duration = Duration::from_secs(12 * 60 * 60);

/// Hard caps on the in-memory maps so a flood of distinct IPs / stale tokens
/// cannot grow them without bound (M2/M3). When exceeded we sweep expired
/// entries first, then refuse to grow further.
const MAX_TOKENS: usize = 256;
const MAX_RATE_BUCKETS: usize = 1024;

/// Router hardening limits (M2/M3/L2): cap request bodies, bound per-request
/// wall-clock, and cap in-flight concurrency so a companion device cannot
/// exhaust the mother's webview process.
const MAX_BODY_BYTES: usize = 1024 * 1024; // 1 MiB — generous for JSON payloads.
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
const WS_PING_INTERVAL: Duration = Duration::from_secs(25);

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
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC snapshot
// ─────────────────────────────────────────────────────────────────────────────

/// Snapshot of the companion server returned to the React layer over IPC.
///
/// Serializes `camelCase` to match the shared TS contract:
/// `{ running, url, port, pairingCode, qrSvg }`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInfo {
    /// Whether the embedded server is currently bound and serving.
    pub running: bool,
    /// LAN URL of the server, e.g. `http://192.168.1.20:8714`. `""` when down.
    pub url: String,
    /// The bound TCP port. `0` when down.
    pub port: u16,
    /// Fresh 6-digit numeric pairing code. `""` when down.
    pub pairing_code: String,
    /// SVG of a QR code encoding `url`. `""` when down.
    pub qr_svg: String,
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
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared hub state (lives across requests; cloned into the axum router)
// ─────────────────────────────────────────────────────────────────────────────

/// A paired companion device entry in the registry.
#[derive(Debug, Clone)]
struct CompanionEntry {
    role: Role,
    /// When the token was minted — used to enforce [`TOKEN_TTL`] (H3).
    created_at: Instant,
    last_seen: Instant,
}

impl CompanionEntry {
    /// A token is expired once it has outlived [`TOKEN_TTL`].
    fn is_expired(&self, now: Instant) -> bool {
        now.duration_since(self.created_at) > TOKEN_TTL
    }
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
    /// token (hex) -> paired companion.
    tokens: HashMap<String, CompanionEntry>,
    /// client-ip -> rate bucket for `POST /pair`.
    pair_rate: HashMap<String, RateBucket>,
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
}

impl Default for HubShared {
    fn default() -> Self {
        let (cart_tx, _) = broadcast::channel(CART_CHANNEL_CAPACITY);
        Self {
            inner: Arc::new(RwLock::new(HubInner::default())),
            cart_tx,
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
    "utun", "tun", "tap", "ppp", "ipsec", "wg", "zt", "tailscale", "proton",
    "bridge", "vmenet", "vnic", "docker", "veth", "vboxnet", "vmnet", "vmwarevmnet",
    "ap", "awdl", "llw", "gif", "stf", "anpi", "lo",
];

/// True when an interface name looks like a virtual / VPN / container adapter
/// (case-insensitive prefix match against [`VIRTUAL_IFACE_PREFIXES`]).
fn is_virtual_iface(name: &str) -> bool {
    let lname = name.to_ascii_lowercase();
    VIRTUAL_IFACE_PREFIXES
        .iter()
        .any(|p| lname.starts_with(p))
}

/// True when `ip` is an RFC-1918 private LAN IPv4 (`10/8`, `172.16/12`,
/// `192.168/16`). These are the only addresses we put in the pairing URL.
fn is_private_lan_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 10
        || (o[0] == 172 && (16..=31).contains(&o[1]))
        || (o[0] == 192 && o[1] == 168)
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
fn lan_ip() -> Ipv4Addr {
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
            eprintln!(
                "warehouse14-pos: companion LAN IP (virtual-iface fallback) = {ip}"
            );
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
            if is_private_lan_v4(mother)
                && is_private_lan_v4(v4)
                && same_private_range(mother, v4)
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
    if ao[0] == 172
        && bo[0] == 172
        && (16..=31).contains(&ao[1])
        && (16..=31).contains(&bo[1])
    {
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

    // Cap the token map (M3): sweep expired entries first; refuse to grow past
    // the hard cap (a working hub never has 256 live companions on one LAN).
    if inner.tokens.len() >= MAX_TOKENS {
        inner.tokens.retain(|_, e| !e.is_expired(now));
        if inner.tokens.len() >= MAX_TOKENS {
            return (StatusCode::SERVICE_UNAVAILABLE, "too many paired devices").into_response();
        }
    }

    inner.tokens.insert(
        token.clone(),
        CompanionEntry {
            role,
            created_at: now,
            last_seen: now,
        },
    );

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
/// which carries the token in a query param (browsers cannot set custom headers
/// on a `new WebSocket(...)` handshake).
async fn auth_role_token(hub: &HubShared, token: &str) -> Option<Role> {
    if token.is_empty() {
        return None;
    }
    let now = Instant::now();
    let mut inner = hub.inner.write().await;
    // Evict-on-use if the token has outlived its TTL.
    if let Some(entry) = inner.tokens.get(token) {
        if entry.is_expired(now) {
            inner.tokens.remove(token);
            return None;
        }
    }
    let entry = inner.tokens.get_mut(token)?;
    entry.last_seen = now;
    Some(entry.role)
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

/// Query string for the `GET /ws` upgrade. The companion token rides here
/// (`/ws?token=…`) because a browser `new WebSocket(url)` cannot attach a custom
/// `X-Companion-Token` header to the upgrade handshake.
#[derive(Deserialize)]
struct WsQuery {
    token: Option<String>,
}

/// `GET /ws` — the realtime customer-display feed (phase 3).
///
/// Authenticates the companion token (query param), enforces the SAME role
/// model as every other endpoint — only a **Display** companion may subscribe,
/// matching its read-only contract — then upgrades to a WebSocket that pushes
/// the latest cart JSON on connect and on every subsequent
/// `companion_publish_cart`. The display re-renders on each push and no longer
/// needs the 1 s `GET /cart` poll (it keeps the poll only as a drop fallback).
///
/// Security: this is a strictly outbound, read-only stream. Inbound frames from
/// the display are ignored (other than the close/ping bookkeeping); the socket
/// can never mutate state or reach the proxy.
async fn ws_handler(
    AxumState(hub): AxumState<HubShared>,
    Query(q): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    let token = q.token.unwrap_or_default();
    let role = match auth_role_token(&hub, &token).await {
        Some(r) => r,
        None => return (StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
    };
    // Same role model as the proxy/cart: only the customer display rides the
    // realtime feed. A cashier/warehouse token is rejected here (they have no
    // need for the push stream and we keep the surface minimal).
    if role != Role::Display {
        return (StatusCode::FORBIDDEN, "forbidden for role").into_response();
    }
    // Snapshot the latest cart NOW so the freshly-connected display paints
    // immediately, and subscribe to the broadcast for every later change.
    let initial = {
        let inner = hub.inner.read().await;
        inner
            .cart_json
            .clone()
            .unwrap_or_else(|| default_cart().to_string())
    };
    let rx = hub.cart_tx.subscribe();
    ws.on_upgrade(move |socket| display_ws_loop(socket, initial, rx))
}

/// Drive one customer-display WebSocket: send the initial snapshot, then fan out
/// every broadcast cart update, keep the socket warm with periodic pings, and
/// exit cleanly when the client closes or the socket errors.
async fn display_ws_loop(
    socket: WebSocket,
    initial: String,
    mut rx: broadcast::Receiver<String>,
) {
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
            // Forward the ORIGINAL (still-encoded) query untouched.
            Some(q.to_string())
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
        "auth", "session", "sessions", "login", "logout", "admin", "settings",
        "system-settings", "users", "owner", "step-up", "stepup", "tse",
        "fiskaly", "export", "gdpr", "kyc",
    ];
    // The first segment (before any `/`) — deny exact or prefix match.
    let seg0 = lower_path.split('/').next().unwrap_or("");
    if FORBIDDEN_PREFIXES.contains(&seg0) {
        return true;
    }
    // Defence in depth: deny anything mentioning void / refund / storno /
    // ankauf / return anywhere in the path, regardless of role.
    const FORBIDDEN_SUBSTR: &[&str] =
        &["void", "refund", "storno", "ankauf", "return", "delete", "destroy"];
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
    let p = lower_path;

    // A read is allowed against `base` if the path is exactly `base` or a
    // sub-resource `base/<id>` (one extra segment), but NOT a sibling action.
    let get_under = |base: &str| -> bool {
        p == base || p.starts_with(&format!("{base}/"))
    };

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
        // Cashier: catalog/customer reads + recent transactions; POST limited
        // to cart-create + finalize. NEVER ankauf / storno / return / void /
        // refund (those are blocked positively here AND by `hard_denied`).
        Role::Cashier => {
            (is_get
                && (get_under("products")
                    || get_under("catalog")
                    || get_under("customers")
                    || get_under("metal-prices")
                    || get_under("metal-rates")
                    || p == "transactions"
                    || p == "transactions/recent"))
                || (is_post && (p == "transactions" || p == "transactions/finalize"))
        }
        // Warehouse: inventory/product reads + write the stock-room actually
        // needs — create a product, edit a single product (rename / re-price /
        // re-shelve / publish), and the inventory-adjust POST. NEVER any
        // transaction, payout, ankauf, storno, or archive/delete (the latter
        // are blocked positively here AND by `hard_denied`).
        Role::Warehouse => {
            (is_get
                && (get_under("products") || get_under("catalog") || get_under("inventory")))
                || (is_post
                    && (p == "products"
                        || p == "inventory/adjust"
                        || (is_product_item_action(p, "inventory-adjustment"))))
                || (is_put && is_product_item())
        }
    }
}

/// `ANY /api/proxy/*path` — role-scoped reverse proxy to the cloud, injecting
/// the mother's `Authorization: Bearer`. Companions never see the credential.
async fn proxy_handler(
    AxumState(hub): AxumState<HubShared>,
    method: Method,
    Path(path): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // 1) Authenticate the companion + resolve its role.
    let role = match auth_role(&hub, &headers).await {
        Some(r) => r,
        None => return (StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
    };

    // 2) Normalise + validate the captured path BEFORE matching (C2). Reject
    //    traversal / control-byte / smuggling attempts with 400.
    let (fwd_path, lower_path) = match normalize_proxy_path(&path) {
        NormPath::Ok { path, lower } => (path, lower),
        NormPath::Rejected => {
            return (StatusCode::BAD_REQUEST, "invalid path").into_response();
        }
    };

    // 3) Second gate: hard-deny list on the normalised, lowercased path.
    if hard_denied(&lower_path) {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }

    // 4) Primary gate: positive, role-scoped allow-set (deny-by-default, C1).
    if !proxy_allowed(role, &method, &lower_path) {
        return (StatusCode::FORBIDDEN, "forbidden for role").into_response();
    }

    // 5) Resolve the mother's Bearer; without it, the proxy cannot speak.
    let bearer = {
        let inner = hub.inner.read().await;
        inner.bearer.clone()
    };
    if bearer.is_empty() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "mother session not available",
        )
            .into_response();
    }

    // 6) Build + send the upstream request from the VALIDATED path only — never
    //    the raw capture. `fwd_path` is decode-safe and traversal-free.
    let url = format!("{CLOUD_BASE}/api/{fwd_path}");
    let client = reqwest::Client::new();
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
            let ct = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json")
                .to_string();
            let bytes = resp.bytes().await.unwrap_or_default();
            let code = StatusCode::from_u16(status.as_u16())
                .unwrap_or(StatusCode::BAD_GATEWAY);
            (code, [(axum::http::header::CONTENT_TYPE, ct)], bytes).into_response()
        }
        Err(err) => {
            eprintln!("warehouse14-pos: companion proxy upstream error: {err}");
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
// IPC commands
// ─────────────────────────────────────────────────────────────────────────────

/// Start the companion hub. Idempotent: if it is already running, returns the
/// existing snapshot untouched. On bind failure returns the `stopped()`
/// snapshot (the POS keeps working — companions just stay unavailable).
#[tauri::command]
pub async fn companion_start(state: State<'_, CompanionState>) -> Result<CompanionInfo, ()> {
    // Fast path: already running → return the live snapshot.
    {
        let guard = state.running.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(running) = guard.as_ref() {
            return Ok(running.info.clone());
        }
    }

    let (listener, port) = match bind_listener().await {
        Ok(bound) => bound,
        Err(err) => {
            eprintln!("warehouse14-pos: companion server bind failed: {err}");
            return Ok(CompanionInfo::stopped());
        }
    };

    let ip = lan_ip();
    let url = format!("http://{ip}:{port}");
    // CSPRNG-only pairing code. If the OS CSPRNG is unavailable we refuse to
    // start a pairable hub (returning the stopped snapshot) rather than issue a
    // weak code — the POS itself keeps working.
    let pairing_code = match fresh_pairing_code() {
        Some(c) => c,
        None => {
            eprintln!("warehouse14-pos: companion CSPRNG unavailable; not starting hub");
            return Ok(CompanionInfo::stopped());
        }
    };
    let qr_svg = qr_svg_for(&url);

    // Rotate the pairing code into shared hub state; clear any stale tokens +
    // rate buckets from a previous session so a fresh code means a fresh start.
    // Record the LAN IP (subnet guard), the code-issued instant (TTL), and
    // reset the global failed-attempt lock.
    {
        let mut inner = state.hub.inner.write().await;
        inner.pairing_code = pairing_code.clone();
        inner.code_issued_at = Some(Instant::now());
        inner.lan_ip = Some(ip);
        inner.global_fail_count = 0;
        inner.tokens.clear();
        inner.pair_rate.clear();
    }

    let info = CompanionInfo {
        running: true,
        url,
        port,
        pairing_code,
        qr_svg,
    };

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let app = build_router(state.hub.clone());
    let task = tokio::spawn(async move {
        // `into_make_service_with_connect_info` surfaces the real TCP peer addr
        // to handlers via `ConnectInfo<SocketAddr>` — required by the per-IP
        // rate limit (H1) and the same-subnet guard (H3).
        let make = app.into_make_service_with_connect_info::<SocketAddr>();
        let server = axum::serve(listener, make).with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        });
        if let Err(err) = server.await {
            eprintln!("warehouse14-pos: companion server exited with error: {err}");
        }
    });

    let snapshot = info.clone();
    {
        let mut guard = state.running.lock().unwrap_or_else(|p| p.into_inner());
        // Re-check under the lock to avoid a double-start race.
        if let Some(running) = guard.as_ref() {
            drop(shutdown_tx);
            task.abort();
            return Ok(running.info.clone());
        }
        *guard = Some(RunningCompanion {
            info,
            shutdown: shutdown_tx,
            task,
        });
    }

    Ok(snapshot)
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
    }
    // Invalidate paired companions + reset the pairing code so a stopped hub
    // can't be reached with a previously-minted token if it restarts.
    {
        let mut inner = state.hub.inner.write().await;
        inner.pairing_code.clear();
        inner.code_issued_at = None;
        inner.lan_ip = None;
        inner.global_fail_count = 0;
        inner.tokens.clear();
        inner.pair_rate.clear();
    }
    Ok(())
}

/// Return the current companion snapshot (running or stopped).
#[tauri::command]
pub async fn companion_status(state: State<'_, CompanionState>) -> Result<CompanionInfo, ()> {
    let guard = state.running.lock().unwrap_or_else(|p| p.into_inner());
    Ok(guard
        .as_ref()
        .map(|r| r.info.clone())
        .unwrap_or_else(CompanionInfo::stopped))
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
