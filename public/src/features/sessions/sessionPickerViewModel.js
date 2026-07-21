import { parentSessionIdentity, sessionIdentity } from "../../lib/sessionIdentity.js";

/** Groups a flat session list into root sessions and their forks without mutating input. */
export function groupSessionFamilies(sessions) {
  const byIdentity = new Map(sessions.map((session) => [sessionIdentity(session), session]));
  const rootOf = (input) => {
    let session = input;
    const seen = new Set();
    while (parentSessionIdentity(session) && byIdentity.has(parentSessionIdentity(session)) && !seen.has(sessionIdentity(session))) {
      seen.add(sessionIdentity(session));
      session = byIdentity.get(parentSessionIdentity(session));
    }
    return session;
  };

  const families = new Map();
  for (const session of sessions) {
    const root = rootOf(session);
    const rootIdentity = sessionIdentity(root);
    if (!families.has(rootIdentity)) families.set(rootIdentity, { session: root, forks: [] });
    if (sessionIdentity(session) !== rootIdentity) families.get(rootIdentity).forks.push(session);
  }
  return [...families.values()];
}

/** Keeps each session family together in the active or inactive partition. */
export function partitionSessionFamilies(sessions, isAlive) {
  const active = [];
  const inactive = [];
  for (const family of groupSessionFamilies(sessions)) {
    const members = [family.session, ...family.forks];
    (members.some(isAlive) ? active : inactive).push(...members);
  }
  return { active, inactive };
}
