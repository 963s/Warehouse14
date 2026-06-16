//! Local P2P terminal discovery via mDNS (`mdns-sd`).
//!
//! Each POS terminal advertises itself as `_w14pos._tcp.local.` and browses for
//! its peers on the LAN, so terminals can find each other when the internet
//! drops. A background thread keeps a shared peer list and emits
//! `w14://mdns/peers` whenever it changes; `get_local_peers` returns the current
//! snapshot.
//!
//! Fail-safe: if mDNS is unavailable (no multicast, sandbox, etc.) the daemon
//! logs and exits — discovery just stays empty; it never crashes the app.

use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::commands::companion::{COMPANION_PORT, lan_ip};

/// Service type advertised + browsed by every Warehouse14 POS terminal.
pub const SERVICE_TYPE: &str = "_w14pos._tcp.local.";
/// Frontend event fired whenever the peer list changes.
pub const PEERS_EVENT: &str = "w14://mdns/peers";

// ── A1: the stable `warehouse14.local` hostname for the phone companion ──────
// The TLS leaf SAN, the `.mobileconfig` Web Clip URL, and the /trust step-4 link
// all target `https://warehouse14.local:8714`, but nothing answered an mDNS
// A-query for that name (only the per-pid `w14pos-<pid>.local` was advertised).
// We register a hostname responder that resolves `warehouse14.local` → the real
// Wi-Fi LAN IPv4 (lan_ip(), pinned to the physical NIC) on the hub port, and a
// watcher re-registers it if the IP changes (Wi-Fi up after launch / DHCP churn).
// For a fully static address, document a DHCP reservation for the mother Mac —
// the leaf also carries the IP SAN, so an IP URL keeps working too.
const HUB_SERVICE_TYPE: &str = "_w14hub._tcp.local.";
const HUB_INSTANCE: &str = "warehouse14";
const HUB_HOSTNAME: &str = "warehouse14.local.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub name: String,
    pub host: String,
    pub port: u16,
}

/// Shared current peer list — managed as Tauri state for `get_local_peers`.
#[derive(Clone)]
pub struct PeerRegistry(pub Arc<Mutex<Vec<PeerInfo>>>);

impl PeerRegistry {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(Vec::new())))
    }
}

impl Default for PeerRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Return the current known peers from the shared registry.
#[tauri::command]
pub fn get_local_peers(registry: State<'_, PeerRegistry>) -> Vec<PeerInfo> {
    registry
        .0
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

/// Spawn the advertise + discover daemon on a background thread. Never panics
/// the app — on any mDNS failure it logs and the thread exits.
pub fn start_mdns_daemon(app: AppHandle, registry: PeerRegistry) {
    thread::spawn(move || {
        if let Err(err) = run_daemon(&app, &registry) {
            eprintln!("warehouse14-pos: mDNS daemon unavailable, skipping: {err}");
        }
    });
}

/// Build the `warehouse14.local` hub ServiceInfo for a given LAN IPv4. The
/// explicit IP (no `enable_addr_auto`) pins the A-record to the real Wi-Fi NIC,
/// not a VPN/Docker address. Exposed for the resolution test.
fn hub_service_info(ip: Ipv4Addr) -> Result<ServiceInfo, mdns_sd::Error> {
    ServiceInfo::new(
        HUB_SERVICE_TYPE,
        HUB_INSTANCE,
        HUB_HOSTNAME,
        IpAddr::V4(ip),
        COMPANION_PORT,
        &[("role", "hub")][..],
    )
}

/// Register `warehouse14.local` → the current Wi-Fi LAN IPv4 and keep it fresh.
///
/// Re-registers only when the IP actually changes (so a stable LAN is a no-op
/// after the first pass) — this self-heals the two real-world cases: Wi-Fi that
/// comes up AFTER app launch (first lan_ip() was loopback), and DHCP churn.
/// Skips loopback (offline / link-down) so we never publish 127.0.0.1 to a phone.
fn spawn_hub_hostname_responder(daemon: ServiceDaemon) {
    thread::spawn(move || {
        let fullname = format!("{HUB_INSTANCE}.{HUB_SERVICE_TYPE}");
        let mut last: Option<Ipv4Addr> = None;
        loop {
            let ip = lan_ip();
            if !ip.is_loopback() && Some(ip) != last {
                match hub_service_info(ip) {
                    Ok(info) => {
                        // Replace any prior record for this name before re-publishing.
                        let _ = daemon.unregister(&fullname);
                        match daemon.register(info) {
                            Ok(()) => {
                                eprintln!(
                                    "warehouse14-pos: mDNS advertising {HUB_HOSTNAME} -> {ip}:{COMPANION_PORT}"
                                );
                                last = Some(ip);
                            }
                            Err(err) => {
                                eprintln!("warehouse14-pos: mDNS hub-hostname register failed: {err}");
                            }
                        }
                    }
                    Err(err) => {
                        eprintln!("warehouse14-pos: mDNS hub-hostname build failed: {err}");
                    }
                }
            }
            thread::sleep(Duration::from_secs(15));
        }
    });
}

fn run_daemon(app: &AppHandle, registry: &PeerRegistry) -> Result<(), Box<dyn std::error::Error>> {
    let daemon = ServiceDaemon::new()?;

    // Advertise this terminal (best-effort — discovery still works if this fails).
    let instance = format!("w14pos-{}", std::process::id());
    let host_name = format!("{instance}.local.");
    let self_prefix = format!("{instance}.");
    match ServiceInfo::new(
        SERVICE_TYPE,
        &instance,
        &host_name,
        (),
        0,
        &[("role", "pos")][..],
    ) {
        Ok(info) => {
            if let Err(err) = daemon.register(info.enable_addr_auto()) {
                eprintln!("warehouse14-pos: mDNS self-advertise failed: {err}");
            }
        }
        Err(err) => eprintln!("warehouse14-pos: mDNS service info build failed: {err}"),
    }

    let receiver = daemon.browse(SERVICE_TYPE)?;

    // A1 — publish `warehouse14.local` on the SAME daemon (cloned), self-healing
    // on IP change. Best-effort: a failure here never stops peer discovery.
    spawn_hub_hostname_responder(daemon.clone());

    // fullname → peer; the source of truth for the discovered set.
    let mut known: BTreeMap<String, PeerInfo> = BTreeMap::new();

    while let Ok(event) = receiver.recv() {
        match event {
            ServiceEvent::ServiceResolved(service) => {
                let fullname = service.get_fullname().to_string();
                if fullname.starts_with(&self_prefix) {
                    continue; // ignore our own advertisement
                }
                known.insert(
                    fullname.clone(),
                    PeerInfo {
                        name: fullname,
                        host: service.get_hostname().to_string(),
                        port: service.get_port(),
                    },
                );
            }
            ServiceEvent::ServiceRemoved(_ty, fullname) => {
                if known.remove(&fullname).is_none() {
                    continue;
                }
            }
            // SearchStarted / ServiceFound / SearchStopped — no peer-set change.
            _ => continue,
        }

        let peers: Vec<PeerInfo> = known.values().cloned().collect();
        let mut guard = registry
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *guard != peers {
            *guard = peers.clone();
            drop(guard);
            // Emit is best-effort; a closed window must not kill the daemon.
            let _ = app.emit(PEERS_EVENT, &peers);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic: the hub ServiceInfo carries the exact name/port/IP that the
    /// `.mobileconfig` Web Clip + the TLS leaf SAN target.
    #[test]
    fn hub_service_info_pins_hostname_port_and_ip() {
        let ip = Ipv4Addr::new(192, 168, 1, 50);
        let info = hub_service_info(ip).expect("hub ServiceInfo builds");
        assert_eq!(info.get_hostname(), HUB_HOSTNAME);
        assert_eq!(info.get_port(), COMPANION_PORT);
        assert!(
            info.get_addresses().iter().any(|a| a.to_string() == ip.to_string()),
            "the A-record must carry the pinned LAN IP",
        );
    }

    /// Real mDNS round-trip: a daemon advertising `warehouse14.local` is resolved
    /// by a second daemon to the published IPv4. Requires LAN multicast; if the
    /// sandbox blocks it the recv times out and the test fails loudly (it is the
    /// provable-here proof of A1 — run it on a multicast-capable host).
    #[test]
    fn warehouse14_local_resolves_to_the_pinned_ip() {
        let ip = Ipv4Addr::new(192, 168, 1, 51);
        let advertiser = ServiceDaemon::new().expect("advertiser daemon");
        advertiser
            .register(hub_service_info(ip).expect("hub info"))
            .expect("register warehouse14.local");

        let browser = ServiceDaemon::new().expect("browser daemon");
        let rx = browser.browse(HUB_SERVICE_TYPE).expect("browse hub type");

        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut resolved = false;
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(ServiceEvent::ServiceResolved(info)) => {
                    assert_eq!(info.get_hostname(), HUB_HOSTNAME);
                    assert!(info.get_addresses().iter().any(|a| a.to_string() == ip.to_string()));
                    resolved = true;
                    break;
                }
                Ok(_) => continue,
                Err(_) => continue,
            }
        }
        let _ = advertiser.shutdown();
        let _ = browser.shutdown();
        assert!(resolved, "warehouse14.local did not resolve via mDNS within 10s");
    }
}
