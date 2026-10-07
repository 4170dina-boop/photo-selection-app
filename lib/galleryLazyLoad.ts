export function makeInitialVisiblePhotoIds(ids: readonly string[], viewportCount: number): Set<string> {
  return new Set(ids.slice(0, Math.max(0, viewportCount)));
}

export function mergeVisiblePhotoIds(current: ReadonlySet<string>, incoming: Iterable<string>): Set<string> {
  const next = new Set(current);
  for (const id of incoming) next.add(id);
  return next;
}

export function syncVisiblePhotoIds(current: ReadonlySet<string>, allowed: Iterable<string>, incoming?: Iterable<string>): Set<string> {
  const next = new Set<string>();
  const allowedIds = new Set(allowed);
  for (const id of current) {
    if (allowedIds.has(id)) next.add(id);
  }
  if (incoming) {
    for (const id of incoming) {
      if (allowedIds.has(id)) next.add(id);
    }
  }
  return next;
}
