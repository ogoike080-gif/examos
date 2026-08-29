// A visitor who lands on "Practice Free" from the landing page has no
// account yet — there's nothing to authenticate. To still give them their 5
// free questions (and know when they've used them, matching the same limit
// a logged-in candidate gets), the server needs *some* stable identifier for
// them across requests. This generates one, once, and persists it — sent as
// the x-anon-id header on every request (see main.jsx), read server-side in
// routes/questions.js only when there's no logged-in user on the request.
const KEY = 'examos-anon-id';

export function getAnonId() {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(KEY, id);
  }
  return id;
}
