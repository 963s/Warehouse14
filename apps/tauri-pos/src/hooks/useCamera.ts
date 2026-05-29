/**
 * useCamera — MediaDevices wrapper for the Day-12 Foto-Werkstatt.
 *
 * Responsibilities:
 *   1. Acquire a MediaStream via `navigator.mediaDevices.getUserMedia`.
 *   2. Enumerate available video inputs for the device-switcher UX.
 *   3. Stop the current stream's tracks before requesting a new one
 *      (otherwise the laptop camera light stays lit + the previous
 *      capture session can hold the device).
 *   4. Surface `permission` + `error` states so the UI can render a
 *      "Erlaubnis erneut anfragen" empty state without crashing.
 *   5. `captureBlob()` draws the current frame to an off-screen canvas
 *      and produces a `image/jpeg` blob at the native resolution.
 *
 * The hook returns refs the caller attaches to a `<video autoPlay
 * playsInline muted>` element. The video element receives `srcObject`,
 * NOT a URL — feeding MediaStream into `src` is incorrect.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraPermission = 'unknown' | 'pending' | 'granted' | 'denied' | 'unavailable';

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface UseCameraResult {
  /** Attach to <video ref={videoRef} autoPlay playsInline muted />. */
  videoRef: React.RefObject<HTMLVideoElement>;
  permission: CameraPermission;
  error: string | null;
  devices: readonly CameraDevice[];
  activeDeviceId: string | null;
  /** Request a fresh permission grant. Re-prompt safe (browser remembers but op can retry). */
  requestPermission: () => Promise<void>;
  /** Switch to a different camera device. Stops the current stream first. */
  switchDevice: (deviceId: string) => Promise<void>;
  /** Stop streaming. Safe to call multiple times. */
  stop: () => void;
  /**
   * Snapshot the current frame as a JPEG blob (~0.92 quality, native
   * resolution). Returns null if the stream isn't active.
   */
  captureBlob: () => Promise<Blob | null>;
}

export interface UseCameraOptions {
  /** Disable the hook entirely (e.g. when a modal needs Enter for submit). */
  enabled?: boolean;
}

export function useCamera(opts: UseCameraOptions = {}): UseCameraResult {
  const { enabled = true } = opts;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [permission, setPermission] = useState<CameraPermission>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<readonly CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);

  const stop = useCallback((): void => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const attachStream = useCallback(
    async (deviceId: string | null): Promise<void> => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setPermission('unavailable');
        setError('MediaDevices API nicht verfügbar in dieser Umgebung.');
        return;
      }

      setPermission('pending');
      setError(null);

      // Stop existing stream BEFORE requesting a new one.
      stop();

      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings();
        setActiveDeviceId(settings?.deviceId ?? deviceId ?? null);
        setPermission('granted');
      } catch (err) {
        if (err instanceof DOMException) {
          if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
            setPermission('denied');
            setError('Kamera-Zugriff verweigert. Bitte in den Systemeinstellungen erlauben.');
            return;
          }
          if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
            setPermission('unavailable');
            setError('Keine Kamera gefunden.');
            return;
          }
        }
        setPermission('denied');
        setError(err instanceof Error ? err.message : 'Unbekannter Kamera-Fehler.');
      }
    },
    [stop],
  );

  const refreshDevices = useCallback(async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all
        .filter((d) => d.kind === 'videoinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label.length > 0 ? d.label : `Kamera ${idx + 1}`,
        }));
      setDevices(cams);
    } catch {
      // Best effort — enumerateDevices can fail in headless env.
    }
  }, []);

  // Initial mount: attempt to acquire the default camera + enumerate.
  useEffect(() => {
    if (!enabled) return;
    void (async (): Promise<void> => {
      await attachStream(null);
      await refreshDevices();
    })();
    return stop;
  }, [enabled, attachStream, refreshDevices, stop]);

  const requestPermission = useCallback(async (): Promise<void> => {
    await attachStream(activeDeviceId);
    await refreshDevices();
  }, [attachStream, activeDeviceId, refreshDevices]);

  const switchDevice = useCallback(
    async (deviceId: string): Promise<void> => {
      await attachStream(deviceId);
    },
    [attachStream],
  );

  const captureBlob = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return null;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
    });
  }, []);

  return {
    videoRef,
    permission,
    error,
    devices,
    activeDeviceId,
    requestPermission,
    switchDevice,
    stop,
    captureBlob,
  };
}
