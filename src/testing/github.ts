import { allowedRequest, fetchGitHub, parseResponse, type GitHubApi } from '../platforms/github-api.ts';
import { HttpError } from '../platforms/http.ts';

/** The GitHub API as the background worker would serve it: the same allowlist and fetch, with the token read directly. */
export function directApi(origin: string, tokenFor: (origin: string) => Promise<string | null>): GitHubApi {
  return {
    async hasToken() {
      return Boolean(await tokenFor(origin));
    },
    async request<T>(url: string, init: { method?: 'GET' | 'POST'; body?: unknown; etag?: string } = {}) {
      const method = init.method ?? 'GET';
      const body = init.body === undefined ? undefined : JSON.stringify(init.body);
      if (!allowedRequest(origin, null, url, method, body)) throw new Error(`Galley does not make this request: ${method} ${url}`);
      let res: Response;
      try {
        res = await fetchGitHub(url, method, body, await tokenFor(origin), init.etag);
      } catch {
        throw new HttpError(0, url, null);
      }
      return parseResponse<T>(url, res.status, await res.text(), res.headers);
    },
  };
}
