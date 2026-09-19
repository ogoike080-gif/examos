// A candidate account is locked to the one device it first registered,
// paid, or logged in from (see server/middleware/auth.js
// checkOrBindDevice). This generates a stable per-browser id, once, and
// persists it — sent as the x-device-id header on every request (see
// main.jsx), read server-side in routes/auth.js (/login, /register) and
// routes/payments.js (/initialize) only.
//
// This is a client-generated identifier stored in localStorage, not a
// hardware fingerprint — clearing site data or using a different browser
// on the SAME physical device produces a new id, which the server would
// treat as a different device. That's a real limitation, not a bug: it
// trades some false positives (a legitimate user who cleared storage gets
// locked out and needs support to reset bound_device_id) for stopping the
// common case this exists for — sharing a password so someone else can log
// in from their own separate device.
const KEY = 'examos-device-id';

export function getDeviceId() {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(KEY, id);
  }
  return id;
}
