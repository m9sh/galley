/**
 * Where the library keeps what it remembers about a project's documents, and for how long (RFC 0074, ADR 0031). This
 * file holds only the storage and its lifetime, with nothing that reads documents, so the toolbar popup, the settings
 * page and the background worker can forget and expire what was kept without loading the Markdown parser.
 * outline-cache.ts reads and writes the readings themselves.
 */

export const DIRECTORY_KEY = 'galley:outlines';
export const RECORD_PREFIX = 'galley:outlines:';

/** A project not used for this long is forgotten. */
export const OUTLINE_LIFETIME = 7 * 24 * 60 * 60 * 1000;
/** Everything remembered, in characters of stored data (about 4 MB; the browser allows extensions 10 MB in all). */
export const OUTLINE_CHARS = 4_000_000;
/** What is remembered of one project; documents past it are read again next time. */
export const OUTLINE_PROJECT_CHARS = 1_000_000;

/** The projects remembered: when each was last used, how much it holds and on which site. Small, so it can be read often. */
export type Directory = Record<string, { used: number; chars: number; site: string }>;

export interface Area {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  keys(): Promise<string[]>;
}

/** Extension storage; the demo page uses localStorage like the rest of its storage. */
export function area(): Area {
  const store = globalThis.chrome?.storage?.local;
  if (store)
    return {
      get: (keys) => store.get(keys),
      set: (items) => store.set(items),
      remove: (keys) => store.remove(keys),
      keys: async () => Object.keys(await store.get(null)),
    };
  return {
    get: async (keys) =>
      Object.fromEntries(
        keys.flatMap((key) => {
          const raw = localStorage.getItem(key);
          return raw === null ? [] : [[key, JSON.parse(raw)]];
        }),
      ),
    set: async (items) => {
      for (const [key, value] of Object.entries(items)) localStorage.setItem(key, JSON.stringify(value));
    },
    remove: async (keys) => {
      for (const key of keys) localStorage.removeItem(key);
    },
    keys: async () => Array.from({ length: localStorage.length }, (_, at) => localStorage.key(at)!),
  };
}

/** A private window reads and keeps nothing. */
export const isPrivate = () => globalThis.chrome?.extension?.inIncognitoContext === true;

/** Changes happen one at a time and in order, so a late write never overwrites a newer one. */
let queue: Promise<unknown> = Promise.resolve();
export function inOrder<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => undefined);
  return run;
}

export async function directory(): Promise<Directory> {
  return ((await area().get([DIRECTORY_KEY]))[DIRECTORY_KEY] as Directory | undefined) ?? {};
}

/** Lets go of projects not used for a week, then the least recently used until the rest fit. The project being saved stays. */
export function evict(projects: Directory, keep: string, now: number): string[] {
  let total = Object.values(projects).reduce((sum, project) => sum + project.chars, 0);
  const dropped: string[] = [];
  const oldestFirst = Object.entries(projects)
    .filter(([hash]) => hash !== keep)
    .sort(([, a], [, b]) => a.used - b.used);
  for (const [hash, project] of oldestFirst) {
    if (now - project.used <= OUTLINE_LIFETIME && total <= OUTLINE_CHARS) break;
    total -= project.chars;
    delete projects[hash];
    dropped.push(hash);
  }
  return dropped;
}

/** Forget every project not used for a week, even if nothing else is saved: the browser has started, or the extension updated. */
export function pruneOutlines(now = Date.now()): Promise<void> {
  return inOrder(async () => {
    const projects = await directory();
    const expired = Object.keys(projects).filter((hash) => now - projects[hash].used > OUTLINE_LIFETIME);
    if (!expired.length) return;
    for (const hash of expired) delete projects[hash];
    await area().remove(expired.map((hash) => RECORD_PREFIX + hash));
    await area().set({ [DIRECTORY_KEY]: projects });
  });
}

/** Forget what was remembered: of one site (when its token is removed), or of every project. Failures are thrown for the reader to see. */
export function forgetOutlines(site?: string): Promise<void> {
  return inOrder(async () => {
    const store = area();
    if (site === undefined) {
      await store.remove((await store.keys()).filter((key) => key === DIRECTORY_KEY || key.startsWith(RECORD_PREFIX)));
      return;
    }
    const projects = await directory();
    const hashes = Object.keys(projects).filter((hash) => projects[hash].site === site);
    for (const hash of hashes) delete projects[hash];
    await store.remove(hashes.map((hash) => RECORD_PREFIX + hash));
    await store.set({ [DIRECTORY_KEY]: projects });
  });
}

/** How much is remembered, for the settings page to say. */
export async function outlineUse(): Promise<{ projects: number; chars: number }> {
  const projects = Object.values(await directory());
  return { projects: projects.length, chars: projects.reduce((sum, project) => sum + project.chars, 0) };
}
