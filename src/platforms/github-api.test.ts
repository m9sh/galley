import { expect, it, vi } from 'vitest';
import { headersOf, mockFetch } from '../testing/http.ts';
import { directApi } from '../testing/github.ts';
import { allowedRequest, backgroundApi, fetchGitHub } from './github-api.ts';
import { HttpError } from './http.ts';
import { ReaderError } from './types.ts';
import { MARK_VIEWED, VIEWED_FILES_QUERY } from './github-queries.ts';

const page = 'https://github.com/acme/docs/pull/12/files';
const api = 'https://api.github.com/repos/acme/docs';
const graphql = (query: string, variables: Record<string, unknown> = { owner: 'acme', repo: 'docs', number: 12 }) => JSON.stringify({ query, variables });

it('the direct API refuses an unsupported endpoint before reading a token or making a request', async () => {
  const tokenFor = vi.fn(),
    fetch = mockFetch(() => new Response('{}'));
  await expect(directApi('https://github.com', tokenFor).request('https://api.github.com/user')).rejects.toThrow('Galley does not make this request');
  expect(tokenFor).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('the background worker allows exactly the GitHub calls the reader makes', () => {
  const ok = (url: string, method = 'GET', body?: string) => allowedRequest('https://github.com', page, url, method, body);
  expect(ok(`${api}/pulls/12`)).toBeTruthy();
  expect(ok(`${api}/pulls/12/files?per_page=100&page=2`)).toBeTruthy();
  expect(ok(`${api}/pulls/12/comments?per_page=100&page=1`)).toBeTruthy();
  expect(ok(`${api}/compare/aaa...bbb`)).toBeTruthy();
  expect(ok(`${api}/pulls/12/comments`, 'POST', '{}')).toBeTruthy();
  expect(ok('https://api.github.com/graphql', 'POST', graphql(VIEWED_FILES_QUERY))).toBeTruthy();
  expect(
    ok('https://api.github.com/graphql', 'POST', JSON.stringify({ query: MARK_VIEWED, variables: { input: { pullRequestId: 'PR', path: 'a.md' } } })),
  ).toBeTruthy();
});

it('anything else is refused, including other repositories and pull requests', () => {
  const no = (url: string, method = 'GET', body?: string, from = page) =>
    expect(allowedRequest('https://github.com', from, url, method, body), `${method} ${url}`).toBe(false);
  no('https://api.github.com/user');
  no('https://api.github.com/user/repos');
  no(`${api}/contents/secret.md`);
  no(`${api}/pulls/12/merge`, 'PUT');
  no(`${api}/pulls/12`, 'PATCH');
  no(`${api}/pulls/12/comments/5`, 'DELETE');
  no(`${api}/issues/12/comments`, 'POST', '{}');
  no('https://api.github.com/repos/other/repo/pulls/12');
  no(`${api}/pulls/13/files`);
  no(`${api}/pulls/13/comments`, 'POST', '{}');
  no('https://api.github.com/graphql', 'POST', graphql('query { viewer { login } }'));
  no('https://api.github.com/graphql', 'POST', graphql(VIEWED_FILES_QUERY, { owner: 'other', repo: 'docs', number: 12 }));
  no('https://api.github.com/graphql', 'GET');
  no('https://evil.example/repos/acme/docs/pulls/12');
  no(`${api}/pulls/12`, 'GET', undefined, 'https://github.com/acme/docs/issues/12');
  // Enterprise: the token's own site only.
  expect(
    allowedRequest('https://git.example.com', 'https://git.example.com/acme/docs/pull/3', 'https://git.example.com/api/v3/repos/acme/docs/pulls/3', 'GET'),
  ).toBeTruthy();
  expect(allowedRequest('https://git.example.com', 'https://git.example.com/acme/docs/pull/3', 'https://api.github.com/repos/acme/docs/pulls/3', 'GET')).toBe(
    false,
  );
});

it('a repository page may only resolve a ref and list the tree of that repository', () => {
  const tree = 'https://github.com/acme/docs/tree/release/2.0/docs';
  const ok = (url: string, from = tree) => allowedRequest('https://github.com', from, url, 'GET');
  expect(ok(`${api}/commits?sha=release%2F2.0&per_page=1`)).toBe(true);
  expect(ok(`${api}/commits?per_page=1`, 'https://github.com/acme/docs')).toBe(true);
  expect(ok(`${api}/git/trees/abc123?recursive=1`, 'https://github.com/acme/docs/blob/main/README.md')).toBe(true);
  expect(ok(`${api}/git/trees/abc123`)).toBe(true);
  const no = (url: string, method = 'GET', body?: string, from = tree) =>
    expect(allowedRequest('https://github.com', from, url, method, body), `${method} ${url} from ${from}`).toBe(false);
  no(`${api}/commits?sha=main&path=secret`);
  no(`${api}/git/trees/abc123?recursive=1&page=2`);
  no(`${api}/git/trees/abc/def`);
  no(`${api}/commits/main`);
  no(`${api}/contents/README.md`);
  no(`${api}/pulls/12`);
  no(`${api}/compare/a...b`);
  no(`${api}/pulls/12/comments`, 'POST', '{}');
  no('https://api.github.com/repos/other/docs/commits?per_page=1');
  no('https://api.github.com/graphql', 'POST', graphql(VIEWED_FILES_QUERY));
  // Other pages read nothing.
  no(`${api}/commits?per_page=1`, 'GET', undefined, 'https://github.com/acme/docs/blob/main/src/app.ts');
  no(`${api}/commits?per_page=1`, 'GET', undefined, 'https://github.com/settings/profile');
});

it('a pull request page may list its own repository’s tree for Project library, and resolve no refs', () => {
  const ok = (url: string) => allowedRequest('https://github.com', page, url, 'GET');
  expect(ok(`${api}/git/trees/headsha?recursive=1`)).toBe(true);
  expect(ok(`${api}/git/trees/subtree`)).toBe(true);
  expect(ok(`${api}/commits?per_page=1`)).toBe(false);
  expect(ok(`${api}/commits?sha=main&per_page=1`)).toBe(false);
  expect(ok(`${api}/git/trees/headsha?recursive=1&path=x`)).toBe(false);
  expect(ok('https://api.github.com/repos/other/docs/git/trees/headsha?recursive=1')).toBe(false);
});

it('tokens are only attached to https requests', async () => {
  const seen: Array<Record<string, string>> = [];
  mockFetch((_url, init) => {
    seen.push(headersOf(init));
    return new Response('{}');
  });
  await fetchGitHub('http://git.example.com/api/v3/repos/a/b/pulls/1', 'GET', undefined, 'secret');
  await fetchGitHub('https://git.example.com/api/v3/repos/a/b/pulls/1', 'GET', undefined, 'secret');
  await fetchGitHub('https://api.github.com/repos/a/b/pulls/1', 'GET', undefined, null);
  expect(seen[0].Authorization).toBeUndefined();
  expect(seen[1].Authorization).toBe('Bearer secret');
  expect(seen[2].Authorization).toBeUndefined();
});

it('refuses malformed requests: an unparsable URL, a GraphQL body that is not JSON, a bare repository and a badly encoded owner', () => {
  const allowed = (url: string, method = 'GET', body?: string) => allowedRequest('https://github.com', page, url, method, body);
  expect(allowed('not a url')).toBe(false);
  expect(allowed('https://api.github.com/graphql', 'POST', '{not json')).toBe(false);
  expect(allowed('https://api.github.com/repos/acme', 'GET')).toBe(false);
  expect(allowed('https://api.github.com/repos/%E0%A4%A/docs/pulls/12')).toBe(false);
  // A known query without variables cannot point at another repository.
  expect(allowed('https://api.github.com/graphql', 'POST', JSON.stringify({ query: VIEWED_FILES_QUERY }))).toBe(true);
});

it('content scripts reach GitHub only through the background worker, which answers with status, body and headers', async () => {
  const sendMessage = vi.fn();
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const worker = backgroundApi();
  sendMessage.mockResolvedValueOnce({ has: true });
  expect(await worker.hasToken()).toBe(true);
  expect(sendMessage).toHaveBeenLastCalledWith({ type: 'galley:has-token' });
  sendMessage.mockResolvedValueOnce({ status: 201, body: '{"id":5}', headers: { 'x-ratelimit-remaining': '42' } });
  const posted = await worker.request<{ id: number }>(`${api}/pulls/12/comments`, { method: 'POST', body: { body: 'Hi' } });
  expect(posted.data).toEqual({ id: 5 });
  expect(posted.headers.get('x-ratelimit-remaining')).toBe('42');
  expect(sendMessage).toHaveBeenLastCalledWith({ type: 'galley:github', url: `${api}/pulls/12/comments`, method: 'POST', body: '{"body":"Hi"}' });
  sendMessage.mockResolvedValueOnce({ status: 404, body: '{}', headers: {} });
  await expect(worker.request(`${api}/pulls/12`)).rejects.toMatchObject({ status: 404 });
});

it('says what went wrong when the worker refuses a request or cannot be reached, and keeps an uncertain write uncertain', async () => {
  const sendMessage = vi.fn();
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const worker = backgroundApi();
  // Refused before anything was sent: not a network problem, so it must not read as one.
  sendMessage.mockResolvedValueOnce({ error: 'Galley does not make this request.' });
  const refused = await worker.request(`${api}/contents/secret.md`).catch((error) => error);
  expect(refused).toBeInstanceOf(ReaderError);
  expect(refused.message).toBe('Galley could not ask GitHub for this page.');
  expect(refused.hint).toBe('Reload the page and open the reader again. The worker said: Galley does not make this request.');
  // A refused write was never made either, so it is certain too.
  sendMessage.mockResolvedValueOnce({ error: 'Refused.' });
  await expect(worker.request(`${api}/pulls/12/comments`, { method: 'POST', body: { body: 'Hi' } })).rejects.toBeInstanceOf(ReaderError);
  // No worker to answer: a read can only be tried again from a page that reaches the worker.
  sendMessage.mockRejectedValue(new Error('Extension context invalidated.'));
  expect(await worker.hasToken()).toBe(false);
  const lost = await worker.request(`${api}/pulls/12`).catch((error) => error);
  expect(lost).toBeInstanceOf(ReaderError);
  expect(lost.message).toBe('Galley could not reach its background worker.');
  sendMessage.mockResolvedValue(undefined);
  await expect(worker.request(`${api}/pulls/12`)).rejects.toBeInstanceOf(ReaderError);
  // A write that got no answer may have been made: it stays status 0, which the reader says it cannot confirm (ADR 0008).
  await expect(worker.request(`${api}/pulls/12/comments`, { method: 'POST', body: { body: 'Hi' } })).rejects.toEqual(
    new HttpError(0, `${api}/pulls/12/comments`, null),
  );
  sendMessage.mockRejectedValue(new Error('port closed'));
  await expect(worker.request(`${api}/pulls/12/comments`, { method: 'POST', body: { body: 'Hi' } })).rejects.toMatchObject({ status: 0 });
  // A network failure in the worker's own request still reads as GitHub being unreachable.
  sendMessage.mockResolvedValue({ status: 0, body: '', headers: {} });
  await expect(worker.request(`${api}/pulls/12`)).rejects.toMatchObject({ status: 0 });
});

it('a read is made conditional by a well-formed ETag, and never a write or a malformed one', async () => {
  const seen: Array<Record<string, string>> = [];
  mockFetch((_url, init) => {
    seen.push(headersOf(init));
    return new Response('{}');
  });
  const url = 'https://api.github.com/repos/a/b/commits?per_page=1';
  await fetchGitHub(url, 'GET', undefined, null, '"abc"');
  await fetchGitHub(url, 'GET', undefined, null, 'W/"abc"');
  await fetchGitHub(url, 'GET', undefined, null, 'abc"; x-evil: 1');
  await fetchGitHub(url, 'POST', '{}', null, '"abc"');
  await fetchGitHub(url, 'GET', undefined, null);
  expect(seen.map((headers) => headers['If-None-Match'])).toStrictEqual(['"abc"', 'W/"abc"', undefined, undefined, undefined]);
});

it('a conditional read that GitHub says has not changed fails with status 304, and the ETag reaches the page', async () => {
  const sendMessage = vi.fn();
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const worker = backgroundApi();
  sendMessage.mockResolvedValueOnce({ status: 200, body: '[]', headers: { etag: '"v1"' } });
  expect((await worker.request(`${api}/commits?per_page=1`)).headers.get('etag')).toBe('"v1"');
  sendMessage.mockResolvedValueOnce({ status: 304, body: '', headers: { etag: '"v1"' } });
  await expect(worker.request(`${api}/commits?per_page=1`, { etag: '"v1"' })).rejects.toMatchObject({ status: 304 });
  expect(sendMessage).toHaveBeenLastCalledWith({ type: 'galley:github', url: `${api}/commits?per_page=1`, method: 'GET', etag: '"v1"' });
  const seen: Array<Record<string, string>> = [];
  mockFetch((_url, init) => {
    seen.push(headersOf(init));
    return new Response(null, { status: 304 });
  });
  await expect(directApi('https://github.com', async () => null).request(`${api}/commits?per_page=1`, { etag: '"v1"' })).rejects.toMatchObject({ status: 304 });
  expect(seen[0]['If-None-Match']).toBe('"v1"');
});
