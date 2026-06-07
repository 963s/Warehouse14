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
//! - `ANY /api/proxy/*path` — a strict, role-scoped allow-list reverse proxy
//!   that forwards to `https://api.warehouse14.de/api/...` with the mother's
//!   Bearer injected. Companions never see the cloud credential.
//! - IPC commands: `companion_start` / `companion_stop` / `companion_status`
//!   (lifecycle) plus `companion_set_auth` (store the mother's Bearer) and
//!   `companion_publish_cart` (publish the latest cart snapshot).
//!
//! # Token & code RNG
//!
//! The 6-digit pairing **code** stays on the non-cryptographic `fastrand` — it
//! is short-lived, rate-limited, and constant-time-compared, so the entropy
//! that matters lives in the **token**. The companion token is 32 bytes from
//! the OS CSPRNG (`getrandom`), hex-encoded. The pairing code is compared with
//! `subtle::ConstantTimeEq` to avoid a timing oracle.

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    body::Bytes,
    extract::{Path, State as AxumState},
    http::{HeaderMap, Method, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use tauri::State;
use tokio::sync::{oneshot, RwLock};
use tokio::task::JoinHandle;

/// Fixed LAN port for the companion hub. Picked from the IANA dynamic range so
/// it is unlikely to collide; falls back to an OS-assigned ephemeral port if
/// 8714 is already bound.
const COMPANION_PORT: u16 = 8714;

/// Base URL of the cloud API. The proxy appends `/api/<path>` to this.
const CLOUD_BASE: &str = "https://api.warehouse14.de";

/// Rate limit for `POST /pair`: at most this many attempts per IP per window.
const PAIR_MAX_ATTEMPTS: u32 = 6;
const PAIR_WINDOW: Duration = Duration::from_secs(60);

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
    last_seen: Instant,
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
    /// The current single-use-per-start pairing code. Empty until a server
    /// starts; rotated on every `companion_start`.
    pairing_code: String,
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
#[derive(Clone, Default)]
struct HubShared(Arc<RwLock<HubInner>>);

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

/// Resolve the primary LAN IPv4 for the pairing URL. Falls back to loopback
/// when no LAN address is available (offline / link-down).
fn lan_ip() -> Ipv4Addr {
    match local_ip_address::local_ip() {
        Ok(std::net::IpAddr::V4(v4)) => v4,
        _ => Ipv4Addr::LOCALHOST,
    }
}

/// Generate a fresh 6-digit numeric pairing code (zero-padded). Short-lived,
/// rate-limited, and constant-time-compared — the real entropy is in the token.
fn fresh_pairing_code() -> String {
    format!("{:06}", fastrand::u32(0..1_000_000))
}

/// Mint an opaque companion token: 32 bytes from the OS CSPRNG, hex-encoded
/// (64 chars). Never derived from the pairing code.
fn mint_token() -> String {
    let mut buf = [0u8; 32];
    // getrandom draws from the OS CSPRNG; failure here is catastrophic and
    // vanishingly rare. Fall back to fastrand only to avoid an unwrap panic in
    // the webview process — still 32 bytes, just not CSPRNG on that one path.
    if getrandom::getrandom(&mut buf).is_err() {
        for b in buf.iter_mut() {
            *b = fastrand::u8(..);
        }
    }
    let mut s = String::with_capacity(64);
    for b in buf {
        s.push_str(&format!("{:02x}", b));
    }
    s
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

/// `GET /` and `GET /app.*` — serve the embedded companion SPA.
async fn serve_spa() -> Html<&'static str> {
    Html(COMPANION_SPA)
}

/// `GET /health` — liveness probe for companions / diagnostics.
async fn health() -> &'static str {
    "ok"
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

/// Extract a best-effort client IP key for rate-limiting. Prefers an
/// `X-Forwarded-For` first hop, else falls back to a constant bucket (still
/// bounds total attempts when the peer addr is unavailable).
fn client_ip_key(headers: &HeaderMap) -> String {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            let ip = first.trim();
            if !ip.is_empty() {
                return ip.to_string();
            }
        }
    }
    "local".to_string()
}

/// `POST /pair` — verify the pairing code (constant-time), validate the role,
/// rate-limit per IP, and on success mint a role-scoped companion token.
async fn pair_handler(
    AxumState(hub): AxumState<HubShared>,
    headers: HeaderMap,
    Json(req): Json<PairReq>,
) -> Response {
    let ip = client_ip_key(&headers);

    // Role must be one of the three known faces.
    let role = match Role::parse(&req.role) {
        Some(r) => r,
        None => return (StatusCode::FORBIDDEN, "invalid role").into_response(),
    };

    let mut inner = hub.0.write().await;

    // ── Rate limit (per IP, sliding fixed window) ──
    let now = Instant::now();
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

    // ── Constant-time code compare ──
    let expected = inner.pairing_code.clone();
    let ok = !expected.is_empty()
        && expected.as_bytes().ct_eq(req.code.as_bytes()).into();
    if !ok {
        return (StatusCode::FORBIDDEN, "invalid code").into_response();
    }

    // ── Success: mint + register ──
    let token = mint_token();
    inner.tokens.insert(
        token.clone(),
        CompanionEntry {
            role,
            last_seen: Instant::now(),
        },
    );

    Json(PairRes {
        token,
        role: role.as_str().to_string(),
    })
    .into_response()
}

/// Read and validate the `X-Companion-Token` header. On success returns the
/// token's role and refreshes its `last_seen`. On failure returns `None`.
async fn auth_role(hub: &HubShared, headers: &HeaderMap) -> Option<Role> {
    let token = headers
        .get("x-companion-token")
        .and_then(|v| v.to_str().ok())?
        .to_string();
    if token.is_empty() {
        return None;
    }
    let mut inner = hub.0.write().await;
    let entry = inner.tokens.get_mut(&token)?;
    entry.last_seen = Instant::now();
    Some(entry.role)
}

/// `GET /cart` — any valid companion may read the latest published cart.
async fn cart_handler(AxumState(hub): AxumState<HubShared>, headers: HeaderMap) -> Response {
    if auth_role(&hub, &headers).await.is_none() {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    let body = {
        let inner = hub.0.read().await;
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

/// Role-scoped allow-list for the proxy.
///
/// Returns `true` only when `role` may call `method <path>` (the `<path>` is the
/// segment AFTER `/api/`, i.e. what we forward to `CLOUD_BASE/api/<path>`).
///
/// The list is deliberately conservative: a companion can never reach auth,
/// admin, settings, or any endpoint outside its face.
fn proxy_allowed(role: Role, method: &Method, path: &str) -> bool {
    // Normalise: drop any querystring for matching, lowercase the leading seg.
    let base = path.split('?').next().unwrap_or(path);
    let base = base.trim_start_matches('/');

    // Hard deny — never reachable by any companion, regardless of role.
    const FORBIDDEN_PREFIXES: &[&str] = &[
        "auth", "session", "sessions", "login", "logout", "admin", "settings",
        "system-settings", "users", "owner", "step-up", "stepup", "tse",
        "fiskaly", "export", "gdpr", "kyc",
    ];
    for p in FORBIDDEN_PREFIXES {
        if base == *p || base.starts_with(&format!("{p}/")) {
            return false;
        }
    }

    let is_get = method == Method::GET;
    let is_post = method == Method::POST;

    let seg0 = base.split('/').next().unwrap_or("");

    match role {
        // Display: read-only catalog / customer-display endpoints only.
        Role::Display => {
            is_get
                && matches!(
                    seg0,
                    "products" | "catalog" | "customer-display" | "metal-prices" | "metal-rates"
                )
        }
        // Cashier: catalog reads + transaction finalize/recent.
        Role::Cashier => {
            (is_get
                && matches!(
                    seg0,
                    "products" | "catalog" | "customers" | "metal-prices" | "metal-rates"
                ))
                || (is_get && (base == "transactions/recent" || base == "transactions"))
                || (is_post
                    && (base == "transactions"
                        || base == "transactions/finalize"
                        || base.starts_with("transactions/")))
        }
        // Warehouse: inventory/product reads + adjust.
        Role::Warehouse => {
            (is_get && matches!(seg0, "products" | "inventory" | "catalog"))
                || (is_post
                    && (base == "inventory/adjust"
                        || base.starts_with("inventory/")
                        || base == "products/adjust"))
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

    // 2) Enforce the strict role-scoped allow-list.
    if !proxy_allowed(role, &method, &path) {
        return (StatusCode::FORBIDDEN, "forbidden for role").into_response();
    }

    // 3) Resolve the mother's Bearer; without it, the proxy cannot speak.
    let bearer = {
        let inner = hub.0.read().await;
        inner.bearer.clone()
    };
    if bearer.is_empty() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "mother session not available",
        )
            .into_response();
    }

    // 4) Build + send the upstream request.
    let url = format!("{CLOUD_BASE}/api/{path}");
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
fn build_router(hub: HubShared) -> Router {
    Router::new()
        .route("/", get(serve_spa))
        .route("/app", get(serve_spa))
        .route("/app.html", get(serve_spa))
        .route("/health", get(health))
        .route("/pair", post(pair_handler))
        .route("/cart", get(cart_handler))
        .route("/api/proxy/*path", any(proxy_handler))
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
    let pairing_code = fresh_pairing_code();
    let qr_svg = qr_svg_for(&url);

    // Rotate the pairing code into shared hub state; clear any stale tokens +
    // rate buckets from a previous session so a fresh code means a fresh start.
    {
        let mut inner = state.hub.0.write().await;
        inner.pairing_code = pairing_code.clone();
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
        let server = axum::serve(listener, app).with_graceful_shutdown(async move {
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
        let mut inner = state.hub.0.write().await;
        inner.pairing_code.clear();
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
    let mut inner = state.hub.0.write().await;
    inner.bearer = bearer;
    Ok(())
}

/// Publish the latest cart snapshot (raw JSON string) for `GET /cart` — drives
/// the customer-display companion. The shape is whatever the JS publishes; the
/// SPA tolerates the common fields (`items[]`, `totalEur`).
#[tauri::command]
pub async fn companion_publish_cart(
    state: State<'_, CompanionState>,
    cart_json: String,
) -> Result<(), ()> {
    let mut inner = state.hub.0.write().await;
    inner.cart_json = Some(cart_json);
    Ok(())
}
