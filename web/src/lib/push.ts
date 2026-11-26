/** Web push on this device: the service worker, the browser's permission, and this browser's subscription. */
import { api } from "../api";

export type PushSupport =
  | "ok"
  // iPhone and iPad only allow push for sites added to the Home Screen.
  | "ios-needs-install"
  | "unsupported";

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (isIos() && !isStandalone()) return "ios-needs-install";
  return capable ? "ok" : "unsupported";
}

/** Registers the service worker once per page load. Safe to call from anywhere. */
let registration: Promise<ServiceWorkerRegistration> | undefined;
export function registerServiceWorker(): Promise<ServiceWorkerRegistration> | undefined {
  if (!("serviceWorker" in navigator)) return undefined;
  registration ??= navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return registration;
}

async function ready(): Promise<ServiceWorkerRegistration> {
  const reg = registerServiceWorker();
  if (!reg) throw new Error("This browser can't do push notifications.");
  await reg;
  return navigator.serviceWorker.ready;
}

/** This browser's current subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  const reg = await ready();
  return reg.pushManager.getSubscription();
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const have = sub.options.applicationServerKey;
  if (!have) return true;
  const want = keyBytes(publicKey);
  const bytes = new Uint8Array(have);
  return bytes.length === want.length && bytes.every((b, i) => b === want[i]);
}

/** A short name for this device in the settings list, like "Chrome on Android". */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua)
    ? "Android"
    : isIos()
      ? /iPad/.test(ua) || navigator.maxTouchPoints > 1 ? "iPad" : "iPhone"
      : /Mac OS X/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : /CrOS/.test(ua)
            ? "Chromebook"
            : /Linux/.test(ua)
              ? "Linux"
              : "this device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return isIos() && isStandalone() ? `Worklight on ${os}` : `${browser} on ${os}`;
}

/**
 * Asks the browser for permission (when it hasn't been given), subscribes, and saves the subscription.
 * Must be called from a tap or click: browsers refuse to ask otherwise. Returns the saved device's id.
 */
export async function turnOnPush(publicKey: string): Promise<string> {
  if (pushSupport() !== "ok") throw new Error("This browser can't do push notifications.");
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for Worklight. Allow them in your browser's site settings, then try again."
        : "Notifications weren't allowed.",
    );
  }
  const reg = await ready();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older server key can't be sent to; replace it.
  if (sub && !sameKey(sub, publicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const json = sub.toJSON();
  const device = await api.addPushDevice({
    kind: "webpush",
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    label: deviceLabel(),
  });
  return device.deviceId;
}

/** Stops push on this browser and forgets it on the server. */
export async function turnOffPush(deviceId: string | undefined): Promise<void> {
  const sub = await currentSubscription();
  if (sub) await sub.unsubscribe();
  if (deviceId) await api.removePushDevice(deviceId);
}

/** The server's id for this browser's subscription (the server derives it from the endpoint). */
export async function thisDeviceId(): Promise<string | undefined> {
  const sub = await currentSubscription();
  if (!sub) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 20);
}
