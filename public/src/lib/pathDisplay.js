const UNIX_HOME_PREFIX = /^(?:\/home\/[^/]+|\/Users\/[^/]+|\/root)(?=\/|$)/;

/** Replaces a conventional Unix home-directory prefix with "~" for display. */
export function abbreviateHomePath(path) {
  return typeof path === "string" ? path.replace(UNIX_HOME_PREFIX, "~") : path;
}
