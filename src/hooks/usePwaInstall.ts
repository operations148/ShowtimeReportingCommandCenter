import { useState, useEffect, useCallback } from 'react';

/**
 * Resolves how (and whether) this device can install the app, and drives the native prompt.
 *
 * The install story differs sharply by platform, so the surface must not pretend one button
 * fits all:
 *   - Chromium (Android / desktop): fires `beforeinstallprompt`; we can trigger it directly.
 *   - iOS Safari: never fires that event — the user must use Share → Add to Home Screen.
 *     We detect iOS and show instructions instead of a dead button.
 *   - Already installed (standalone): nothing to do.
 *   - GHL marketplace iframe: a PWA cannot be installed from inside a cross-origin frame;
 *     offering it would only confuse.
 */

export type InstallStatus =
  | 'installed'      // running as an installed app already
  | 'installable'    // native prompt is available right now
  | 'ios-manual'     // iOS Safari — manual Add to Home Screen
  | 'in-iframe'      // embedded (e.g. GHL) — not installable here
  | 'unsupported';   // no prompt captured and not a known manual path

interface PwaInstall {
  status: InstallStatus;
  /** Triggers the native prompt. Resolves to the user's choice, or 'unavailable'. */
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    __pwaInstall?: { deferredPrompt: BeforeInstallPromptEvent | null; installed: boolean };
  }
}

function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      // iOS Safari exposes this non-standard flag when launched from the home screen.
      || (window.navigator as any).standalone === true;
  } catch { return false; }
}

function isIOS(): boolean {
  const ua = window.navigator.userAgent;
  // iPadOS 13+ reports as "Macintosh"; the touch-point check disambiguates a real Mac.
  return /iP(hone|ad|od)/.test(ua)
    || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
}

function inIframe(): boolean {
  try { return window.self !== window.top; } catch { return true; }
}

function resolveStatus(hasPrompt: boolean): InstallStatus {
  if (isStandalone() || window.__pwaInstall?.installed) return 'installed';
  if (inIframe()) return 'in-iframe';
  if (hasPrompt) return 'installable';
  if (isIOS()) return 'ios-manual';
  return 'unsupported';
}

export function usePwaInstall(): PwaInstall {
  const [status, setStatus] = useState<InstallStatus>(() =>
    resolveStatus(!!window.__pwaInstall?.deferredPrompt)
  );

  useEffect(() => {
    const recompute = () => setStatus(resolveStatus(!!window.__pwaInstall?.deferredPrompt));

    // The index.html shim relays these once it captures / observes the browser events.
    window.addEventListener('pwa-installable', recompute);
    window.addEventListener('pwa-installed', recompute);

    // Re-resolve if the display mode flips (e.g. the user installs, then opens standalone).
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener?.('change', recompute);

    return () => {
      window.removeEventListener('pwa-installable', recompute);
      window.removeEventListener('pwa-installed', recompute);
      mq.removeEventListener?.('change', recompute);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const evt = window.__pwaInstall?.deferredPrompt;
    if (!evt) return 'unavailable';
    await evt.prompt();
    const choice = await evt.userChoice;
    // A prompt is single-use; discard it so the button reflects reality afterward.
    window.__pwaInstall!.deferredPrompt = null;
    setStatus(resolveStatus(false));
    return choice.outcome;
  }, []);

  return { status, promptInstall };
}
