/**
 * useAudioDevices — zero-config audio device discovery for Vierzehn.
 *
 * Enumerates the audio inputs/outputs the OS exposes (built-in, USB, Bluetooth,
 * and network devices the OS has already connected such as AirPlay), auto-picks
 * the system default, and re-discovers whenever a device is plugged or unplugged.
 * Runs in the background so the owner never configures anything.
 *
 * Honest scope: this uses the OS device list (`enumerateDevices`), NOT a LAN
 * scan and NOT driver installation — that would be a privacy/security overreach
 * and is not how audio routing works. The OS owns pairing; we just pick well.
 * Labels populate once microphone permission has been granted at least once.
 */

import { useCallback, useEffect, useState } from 'react';

export interface AudioDevices {
  mics: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
  selectedMicId: string | undefined;
  selectedSpeakerId: string | undefined;
  refresh: () => Promise<void>;
}

function pickDefault(list: MediaDeviceInfo[]): string | undefined {
  // WebKit (the desktop WebView) exposes no Chromium-style 'default' pseudo-device
  // and, before a permission grant, emits entries with an EMPTY deviceId. An empty
  // id must read as „no selection" (undefined → the OS default mic), never get
  // pinned into a `{ deviceId: { exact: '' } }` constraint that then over-constrains.
  const picked = (list.find((d) => d.deviceId === 'default') ?? list[0])?.deviceId;
  return picked ? picked : undefined;
}

export function useAudioDevices(): AudioDevices {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string | undefined>(undefined);
  const [selectedSpeakerId, setSelectedSpeakerId] = useState<string | undefined>(undefined);

  const refresh = useCallback(async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const ins = devices.filter((d) => d.kind === 'audioinput');
      const outs = devices.filter((d) => d.kind === 'audiooutput');
      setMics(ins);
      setSpeakers(outs);
      setSelectedMicId((prev) => prev ?? pickDefault(ins));
      setSelectedSpeakerId((prev) => prev ?? pickDefault(outs));
    } catch {
      /* enumeration blocked; the assistant falls back to the system default mic */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md?.addEventListener) return;
    const onChange = () => void refresh();
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [refresh]);

  return { mics, speakers, selectedMicId, selectedSpeakerId, refresh };
}
