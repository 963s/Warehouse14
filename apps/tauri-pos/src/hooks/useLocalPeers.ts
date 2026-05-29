/**
 * useLocalPeers — discover other Warehouse14 POS terminals on the LAN via the
 * native mDNS daemon (`_w14pos._tcp.local.`). The Rust side advertises this
 * terminal and browses for peers; it emits `w14://mdns/peers` whenever the peer
 * set changes. On mount we also pull the current snapshot via `get_local_peers`
 * so the list is populated immediately (events only fire on subsequent changes).
 *
 * Fail-safe: if mDNS is unavailable the backend simply never emits and returns
 * an empty list — this hook stays at `[]` and never throws.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

export interface PeerInfo {
  /** mDNS fullname, e.g. `w14pos-1234._w14pos._tcp.local.`. */
  name: string;
  /** Resolved hostname, e.g. `w14pos-1234.local.`. */
  host: string;
  port: number;
}

const PEERS_EVENT = 'w14://mdns/peers';

export function useLocalPeers(): PeerInfo[] {
  const [peers, setPeers] = useState<PeerInfo[]>([]);

  useEffect(() => {
    let active = true;

    // Initial snapshot — the event only fires on later changes.
    invoke<PeerInfo[]>('get_local_peers')
      .then((initial) => {
        if (active) setPeers(initial);
      })
      .catch(() => {
        // mDNS unavailable or command missing — stay empty.
      });

    // Subscribe to live peer-set changes.
    const unlistenPromise = listen<PeerInfo[]>(PEERS_EVENT, (event) => {
      if (active) setPeers(event.payload);
    });

    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return peers;
}
