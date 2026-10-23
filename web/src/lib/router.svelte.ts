let pathname = $state("/");

export function currentPath(): string {
  if (typeof location === "undefined") return "/";
  const basePath = new URL(document.baseURI).pathname.replace(/\/$/, "");
  let path = location.pathname;
  if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length);
  if (!path.startsWith("/")) path = `/${path}`;
  return path || "/";
}

export function routePath(): string {
  return pathname;
}

export function hrefFor(path: string): string {
  const next = path.startsWith("/") ? path.slice(1) : path;
  return new URL(next, document.baseURI).pathname;
}

export function navigate(path: string): void {
  const next = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(next, document.baseURI);
  history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  pathname = currentPath();
}

export function followLink(event: MouseEvent, path: string): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
    return;
  event.preventDefault();
  navigate(path);
}

if (typeof window !== "undefined") {
  pathname = currentPath();
  window.addEventListener("popstate", () => {
    pathname = currentPath();
  });
}
