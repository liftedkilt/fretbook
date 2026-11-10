/** What went wrong, where and on which version: the text behind "Copy details" on the error screen. */
export function crashDetails(error: unknown, path: string, version: string | null): string {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : `Error: ${String(error)}`;
  const stack = error instanceof Error && error.stack ? error.stack : "";
  // Chrome's stack starts with the message; Firefox's and Safari's do not.
  const trace = stack.startsWith(message) ? stack.slice(message.length).trim() : stack.trim();
  return [message, `Page: ${path}`, version ? `Fretbook ${version}` : "", trace]
    .filter((line) => line !== "")
    .join("\n");
}
