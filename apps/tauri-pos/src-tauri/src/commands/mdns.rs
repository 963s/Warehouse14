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
use std::sync::{Arc, Mutex};
use std::thread;

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// Service type advertised + browsed by every Warehouse14 POS terminal.
pub const SERVICE_TYPE: &str = "_w14pos._tcp.local.";
/// Frontend event fired whenever the peer list changes.
pub const PEERS_EVENT: &str = "w14://mdns/peers";

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

fn run_daemon(app: &AppHandle, registry: &PeerRegistry) -> Result<(), Box<dyn std::error::Error>> {
    let daemon = ServiceDaemon::new()?;

    // Advertise this terminal (best-effort — discovery still works if this fails).
    let instance = format!("w14pos-{}", std::process::id());
    let host_name = format!("{instance}.local.");
    let self_prefix = format!("{instance}.");
    match ServiceInfo::new(SERVICE_TYPE, &instance, &host_name, (), 0, &[("role", "pos")][..]) {
        Ok(info) => {
            if let Err(err) = daemon.register(info.enable_addr_auto()) {
                eprintln!("warehouse14-pos: mDNS self-advertise failed: {err}");
            }
        }
        Err(err) => eprintln!("warehouse14-pos: mDNS service info build failed: {err}"),
    }

    let receiver = daemon.browse(SERVICE_TYPE)?;

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
        let mut guard = registry.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if *guard != peers {
            *guard = peers.clone();
            drop(guard);
            // Emit is best-effort; a closed window must not kill the daemon.
            let _ = app.emit(PEERS_EVENT, &peers);
        }
    }

    Ok(())
}
