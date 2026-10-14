import { OUTLINE_FORMAT, restoreDoc, storeDoc, type IndexedDoc, type StoredDoc } from '../../core/docindex.ts';
import {
  area,
  directory,
  DIRECTORY_KEY,
  evict,
  inOrder,
  isPrivate,
  OUTLINE_LIFETIME,
  OUTLINE_PROJECT_CHARS,
  RECORD_PREFIX,
  type Directory,
} from './outline-store.ts';
import { digestText } from './project-store.ts';

/**
 * What the library remembers about the documents of a project it has read, when the reader allows it
 * (Settings → Remembering projects; RFC 0074, ADR 0031): each document's title, kind, headings and links, with the
 * hash of the content they were read from, never the text. Read again, a project's map opens at once, and only
 * documents whose hash changed are read. It lives in extension storage on this device, for one week after it was
 * last used and within a fixed size, nothing is kept from a private window, and the reader can forget it at any time.
 * The records are keyed by a fingerprint of the project, like notes (project-store.ts). Storage, expiry and forgetting
 * are in outline-store.ts.
 */

interface Item {
  blob: string;
  doc: StoredDoc;
}
interface Record_ {
  /** The shape of the readings kept (docindex.ts OUTLINE_FORMAT). */
  v: number;
  /** The Galley version that made them: a new version may read documents differently, so it starts over. */
  app: string;
  docs: Record<string, Item>;
}

/** A document's reading, and the content hash it was made from: still good while the listing gives the same hash. */
export interface Remembered {
  blob: string;
  doc: IndexedDoc;
}

const appVersion = () => globalThis.chrome?.runtime?.getManifest?.().version ?? 'demo';

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
    if (!entry || now - entry.used > OUTLINE_LIFETIME || record?.v !== OUTLINE_FORMAT || record.app !== appVersion()) return found;
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
    const record: Record_ = { v: OUTLINE_FORMAT, app: appVersion(), docs: items };
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
