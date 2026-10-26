const versions = $state<Record<string, number>>({});

export function songVersion(id: string): number {
  return versions[id] ?? 0;
}

export function invalidateSong(id: string): void {
  versions[id] = (versions[id] ?? 0) + 1;
}
