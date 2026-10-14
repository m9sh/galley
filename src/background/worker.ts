// Background worker: the only place that reads GitHub tokens and sends them to GitHub.
// Content scripts ask for specific API calls; the token never enters the page's renderer.
import { allowedRequest, fetchGitHub, FORWARDED_HEADERS, type ApiMessage, type ApiReply } from '../platforms/github-api.ts';
import { restoreSites } from '../platforms/sites.ts';
import { pruneOutlines } from '../platforms/outline-store.ts';
import { OPEN_READER, READ_COMMAND } from '../platforms/page-actions.ts';
import { getToken, migrateTokens } from '../platforms/tokens.ts';

/**
 * The page a request is for. The browser keeps `sender.url` at the address the document was loaded at, so once GitHub moves to
 * another page without loading one (a click from the pull request list to a pull request) it names a page the reader has left,
 * and every request would be judged against that. The tab's own address follows the navigation.
 *
 * Both come from the browser, never from the message. The tab's address counts only for the top frame and only on the site the
 * frame is on, so a frame cannot name a page other than its own, and the token is still looked up by the frame's own site.
 */
function pageOf(sender: chrome.runtime.MessageSender): URL {
  const loaded = new URL(sender.url!);
  const current = sender.frameId === 0 && sender.tab?.url ? new URL(sender.tab.url) : null;
  return current?.origin === loaded.origin ? current : loaded;
}

async function handle(message: ApiMessage, sender: chrome.runtime.MessageSender): Promise<ApiReply | { has: boolean }> {
  // Only Galley's own content scripts, and the site comes from the browser, not from the message.
  if (sender.id !== chrome.runtime.id || !sender.tab || !sender.url) return { error: 'Refused.' };
  const page = pageOf(sender);
  const token = page.protocol === 'https:' ? await getToken(page.origin) : null;
  if (message.type === 'galley:has-token') return { has: Boolean(token) };
  if (!allowedRequest(page.origin, page.href, message.url, message.method, message.body)) return { error: 'Galley does not make this request.' };
  try {
    const res = await fetchGitHub(message.url, message.method, message.body, token, message.etag);
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_HEADERS) {
      const value = res.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    return { status: res.status, body: await res.text(), headers };
  } catch {
    return { status: 0, body: '', headers: {} };
  }
}

chrome.runtime.onMessage.addListener((message: ApiMessage, sender, reply) => {
  if (message?.type !== 'galley:github' && message?.type !== 'galley:has-token') return false;
  handle(message, sender).then(reply, (err) => reply({ error: err instanceof Error ? err.message : String(err) }));
  return true;
});

// Sites enabled from the popup lose their content script when the extension updates: restore them.
const restore = () => {
  restoreSites().catch(() => {
    // A site the browser cannot register for stays listed as off in the popup, where it can be enabled again.
  });
  // Remembered project outlines expire a week after their last use even when nothing is read or saved in the meantime.
  pruneOutlines().catch(() => {
    // They are checked again on the next start, and are never used past their week.
  });
};
chrome.runtime.onInstalled.addListener(restore);
chrome.runtime.onStartup.addListener(restore);

migrateTokens().catch(() => {
  // Tokens stay where they were and are migrated on the next start.
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== READ_COMMAND) return;
  void chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]) => {
      if (tab?.id !== undefined) return chrome.tabs.sendMessage(tab.id, { type: OPEN_READER });
    })
    .catch(() => {
      // No content script on this page: the shortcut leaves it alone.
    });
});
