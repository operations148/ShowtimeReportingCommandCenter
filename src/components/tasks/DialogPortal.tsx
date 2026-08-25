import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders overlay content into <body> instead of in place.
 *
 * WHY THIS EXISTS: the app shell wraps view content in a div that carries a CSS `transform`
 * (the fade-in transition in App.tsx). A transformed element becomes the containing block for
 * every `position: fixed` descendant, so a `fixed inset-0` overlay rendered inside it is
 * anchored to that wrapper — not the viewport. In practice the dialog is offset by the header
 * and can scroll off-screen entirely, taking its close button with it.
 *
 * Portalling to <body> puts the overlay outside the transformed subtree, so `fixed` means
 * fixed again. Nothing else about the dialogs changes: they keep their own focus trap,
 * Escape handling and aria wiring, and React still treats them as children for context and
 * event bubbling.
 *
 * The portal is created during render, not deferred behind an effect. Deferring would mean
 * the dialog's own mount effect — the one that moves focus to its close button — runs while
 * its refs are still null, silently breaking focus management for keyboard and screen-reader
 * users. This app renders only in the browser (src/main.tsx mounts into #root; there is no
 * SSR pass), so document.body is always available here.
 */
export default function DialogPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
