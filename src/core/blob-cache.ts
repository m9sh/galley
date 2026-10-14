import { indexDocument, type IndexedDoc } from './docindex.ts';
import { BLOB_CACHE_CHARS } from './limits.ts';

interface Kept {
  text: string;
  /** What the map learned from the text at one path; links are resolved from the path, so a rename is read again. */
  indexed?: IndexedDoc;
}

/**
 * Documents the repository reader has read, by the hash of their content (RFC 0074). A hash names one text
 * wherever it appears, so after a refresh to a newer commit only documents with a new hash are read again,
 * and the map keeps what it learned from the rest. It lives in the reader's memory and is let go when the
 * reader closes; past `limit` characters the document read longest ago is dropped.
 */
export class BlobCache {
  private readonly kept = new Map<string, Kept>();
  private chars = 0;

  constructor(private readonly limit = BLOB_CACHE_CHARS) {}

  get size(): number {
    return this.kept.size;
  }

  /** The text with this hash, if it was read; it counts as used again. */
  text(blob: string): string | undefined {
    const entry = this.kept.get(blob);
    if (!entry) return undefined;
    this.kept.delete(blob);
    this.kept.set(blob, entry);
    return entry.text;
  }

  put(blob: string, text: string): void {
    if (this.kept.has(blob)) return void this.text(blob);
    if (text.length > this.limit) return;
    this.kept.set(blob, { text });
    this.chars += text.length;
    for (const [oldest, entry] of this.kept) {
      if (this.chars <= this.limit) break;
      this.kept.delete(oldest);
      this.chars -= entry.text.length;
    }
  }

  /** The map's reading of a document, from the cache when this hash was already read at this path. */
  indexed(blob: string | undefined, path: string, text: string): IndexedDoc {
    const entry = blob === undefined ? undefined : this.kept.get(blob);
    if (entry?.indexed?.path === path && entry.text === text) return entry.indexed;
    const doc = indexDocument(path, text);
    if (entry && entry.text === text) entry.indexed = doc;
    return doc;
  }

  clear(): void {
    this.kept.clear();
    this.chars = 0;
  }
}
