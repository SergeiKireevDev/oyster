/** Convert a thrown value to text. This is not a redaction or non-throwing boundary. */
export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
