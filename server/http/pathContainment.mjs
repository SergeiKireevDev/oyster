import { isAbsolute, relative, sep } from "node:path";

/** Lexical containment only: callers still own canonicalization and authorization. */
export function isWithin(path, root) {
  const relationship = relative(root, path);
  return relationship === ""
    || (!isAbsolute(relationship) && relationship !== ".." && !relationship.startsWith(`..${sep}`));
}
