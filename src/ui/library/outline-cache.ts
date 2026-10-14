import { OUTLINE_FORMAT, restoreDoc, storeDoc, type IndexedDoc, type StoredDoc } from '../../core/docindex.ts';
import { digestText } from './project-store.ts';

/**
 * What the library remembers about the documents of a project it has read, when the reader allows it
 * (Settings → Remembering projects; RFC 0074, ADR 0031): each document's title, kind, headings and links, with the
 * hash of the content they were read from, never the text. Read again, a project's map opens at once, and only
 * documents whose hash changed are read. It lives in extension storage on this device, for one week after it was
 * last used and within a fixed size, nothing is kept from a private window, and the reader can forget it at any time.
 * The records are keyed by a fingerprint of the project, like notes (project-store.ts).
 */

const DIRECTORY_KEY = 'galley:outlines';
const RECORD_PREFIX = 'galley:outlines:';

/** A project not used for this long is forgotten. */
export const OUTLINE_LIFETIME = 7 * 24 * 60 * 60 * 1000;
/** Everything remembered, in characters of stored data (about 4 MB; the browser allows extensions 10 MB in all). */
export const OUTLINE_CHARS = 4_000_000;
/** What is remembered of one project; documents past it are read again next time. */
export const OUTLINE_PROJECT_CHARS = 1_000_000;

/** The projects remembered: when each was last used, how much it holds and on which site. Small, so it can be read often. */
type Directory = Record<string, { used: number; chars: number; site: string }>;
interface Item {
  blob: string;
  doc: StoredDoc;
}
interface Record_ {
  v: number;
  docs: Record<string, Item>;
}

/** A document's reading, and the content hash it was made from: still good while the listing gives the same hash. */
export interface Remembered {
  blob: string;
  doc: IndexedDoc;
}

interface Area {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  keys(): Promise<string[]>;
}

/** Extension storage; the demo page uses localStorage like the rest of its storage. */
function area(): Area {
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
const isPrivate = () => globalThis.chrome?.extension?.inIncognitoContext === true;

/** Changes happen one at a time and in order, so a late write never overwrites a newer one. */
let queue: Promise<unknown> = Promise.resolve();
function inOrder<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => undefined);
  return run;
}

async function directory(): Promise<Directory> {
  return ((await area().get([DIRECTORY_KEY]))[DIRECTORY_KEY] as Directory | undefined) ?? {};
}

/** What is remembered of a project's documents, by path. A reading that is damaged, old, or for a private window is left out. */
export async function recallOutlines(repository: string, now = Date.now()): Promise<Map<string, Remembered>> {
  const found = new Map<string, Remembered>();
  if (isPrivate()) return found;
  try {
    const hash = await digestText(repository);
    const key = RECORD_PREFIX + hash;
    const stored = await area().get([DIRECTORY_KEY, key]);
    const entry = (stored[DIRECTORY_KEY] as Directory | undefined)?.[hash];
    const record = stored[key] as Partial<Record_> | undefined;
    if (!entry || now - entry.used > OUTLINE_LIFETIME || record?.v !== OUTLINE_FORMAT) return found;
    for (const [path, item] of Object.entries(record.docs ?? {})) {
      const doc = restoreDoc(item?.doc, path);
      if (doc && typeof item.blob === 'string') found.set(path, { blob: item.blob, doc });
    }
  } catch {
    // Unreadable storage is the same as nothing remembered: the documents are read.
    found.clear();
  }
  return found;
}

/** Lets go of projects not used for a week, then the least recently used until the rest fit. The project being saved stays. */
function evict(projects: Directory, keep: string, now: number): string[] {
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

/**
 * Remember these readings for a project, replacing what was remembered of it. They are kept as long as they fit
 * the project's share; a store that is full or unavailable is not worth telling the reader about.
 */
export function rememberOutlines(
  repository: string,
  site: string,
  docs: Array<{ path: string; blob: string; doc: IndexedDoc }>,
  now = Date.now(),
): Promise<void> {
  if (isPrivate()) return Promise.resolve();
  return inOrder(async () => {
    const hash = await digestText(repository);
    const items: Record<string, Item> = {};
    let chars = 0;
    for (const { path, blob, doc } of docs) {
      const item = { blob, doc: storeDoc(doc) };
      const size = path.length + JSON.stringify(item).length;
      if (chars + size > OUTLINE_PROJECT_CHARS) continue;
      items[path] = item;
      chars += size;
    }
    const projects = await directory();
    projects[hash] = { used: now, chars, site };
    const dropped = evict(projects, hash, now);
    const record: Record_ = { v: OUTLINE_FORMAT, docs: items };
    await area().set({ [RECORD_PREFIX + hash]: record, [DIRECTORY_KEY]: projects });
    if (dropped.length) await area().remove(dropped.map((gone) => RECORD_PREFIX + gone));
  }).catch(() => undefined);
}

/** Mark a project as used now, without writing its documents again. */
export function touchOutlines(repository: string, now = Date.now()): Promise<void> {
  if (isPrivate()) return Promise.resolve();
  return inOrder(async () => {
    const hash = await digestText(repository);
    const projects = await directory();
    if (projects[hash]) await area().set({ [DIRECTORY_KEY]: { ...projects, [hash]: { ...projects[hash], used: now } } });
  }).catch(() => undefined);
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
