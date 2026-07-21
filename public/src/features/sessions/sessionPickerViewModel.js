/** Groups a flat session list into root sessions and their forks without mutating input. */
export function groupSessionFamilies(sessions) {
  const byPath = new Map(sessions.map((session) => [session.path, session]));
  const rootOf = (input) => {
    let session = input;
    const seen = new Set();
    while (session.parentSession && byPath.has(session.parentSession) && !seen.has(session.path)) {
      seen.add(session.path);
      session = byPath.get(session.parentSession);
    }
    return session;
  };

  const families = new Map();
  for (const session of sessions) {
    const root = rootOf(session);
    if (!families.has(root.path)) families.set(root.path, { session: root, forks: [] });
    if (session.path !== root.path) families.get(root.path).forks.push(session);
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
