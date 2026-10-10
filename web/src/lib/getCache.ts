/** Short memory for list requests so opening another page does not wait on the server again. */
const fresh = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const TTL = 20000;

export function cachedGet<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = fresh.get(key);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data as T);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const run = load()
    .then((data) => {
      fresh.set(key, { at: Date.now(), data });
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, run);
  return run;
}

export function clearGetCache(): void {
  fresh.clear();
}
