import { beforeAll, afterEach, expect, test, vi } from 'vitest';

type BundlesModule = typeof import('./bundles');

const SAMPLE_HTML = `
<a data-ds-bundleid="123" data-ds-bundle-data="{&quot;m_rgItems&quot;:[{&quot;m_rgIncludedAppIDs&quot;:[111]}]}">
  <span class="title">Sample Bundle</span>
</a>
<a data-ds-bundleid="456" data-ds-bundle-data="{&quot;m_rgItems&quot;:[{&quot;m_rgIncludedAppIDs&quot;:[222]}]}">
  <span class="title">Other Bundle</span>
</a>`;

const SANITIZED_BUNDLE_LIST = `
Title: Example Bundle List

URL Source: https://store.steampowered.com/bundlelist/42

Markdown Content:
[![Image 1: Foo Bundle](https://example.com/foo.jpg)](https://store.steampowered.com/bundle/12345)
bundle Includes 2 items

[![Image 2: Bar Bundle](https://example.com/bar.jpg)](https://store.steampowered.com/bundle/67890)
bundle Includes 5 items

Some footer content.`;

const SANITIZED_BUNDLE_PAGE = `
Title: Save 22% on House Flipper 2 x Spray Paint Simulator on Steam

URL Source: https://store.steampowered.com/bundle/54347?l=english&cc=us

Markdown Content:
Save 22% on House Flipper 2 x Spray Paint Simulator on Steam
`;

let bundlesModule: BundlesModule;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  const globalObject = globalThis as {
    window?: { document?: unknown };
    document?: unknown;
  };

  if (!globalObject.window) {
    globalObject.window = { document: {} };
  } else if (!globalObject.window.document) {
    globalObject.window.document = {};
  }

  if (!globalObject.document) {
    globalObject.document = globalObject.window.document;
  }

  bundlesModule = await import('./bundles');
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

test('extractBundlesFromHtml filters bundles by app id', () => {
  const { extractBundlesFromHtml } = bundlesModule;
  const result = extractBundlesFromHtml(SAMPLE_HTML, '111');
  expect(result).toEqual([{ id: '123', name: 'Sample Bundle' }]);
});

test('extractBundleIdsFromHtml handles sanitized markdown bundle list', () => {
  const { extractBundleIdsFromHtml } = bundlesModule;
  const ids = extractBundleIdsFromHtml(SANITIZED_BUNDLE_LIST);
  expect(ids).toEqual(['12345', '67890']);
});

test('fetchBundleNames falls back to proxy URLs when direct requests fail due to CORS', async () => {
  const { fetchBundleNames } = bundlesModule;

  const appId = '4242';
  const directBundleListUrl = `https://store.steampowered.com/bundlelist/${appId}`;
  const directBundleUrl = (bundleId: string) =>
    `https://store.steampowered.com/bundle/${bundleId}?l=english&cc=us`;
  const proxyBundleListUrl = `https://r.jina.ai/${directBundleListUrl}`;
  const proxyBundleUrl = (bundleId: string) => `https://r.jina.ai/${directBundleUrl(bundleId)}`;

  const bundleListHtml = `
    <a href="https://store.steampowered.com/bundle/100"></a>
    <a href="https://store.steampowered.com/bundle/200"></a>
  `;
  const bundleMetadataHtml = new Map([
    ['100', '<h2 class="pageheader">Proxy Tiny Bundle</h2>'],
    ['200', '<h2 class="pageheader">Proxy Town Bundle</h2>'],
  ]);

  const responses = new Map<string, string>([
    [proxyBundleListUrl, bundleListHtml],
    [`https://cors.isomorphic-git.org/${directBundleListUrl}`, bundleListHtml],
    ...Array.from(bundleMetadataHtml.entries()).flatMap(([bundleId, html]) => [
      [proxyBundleUrl(bundleId), html],
      [`https://cors.isomorphic-git.org/${directBundleUrl(bundleId)}`, html],
    ] as [string, string]),
  ]);

  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : input instanceof Request
        ? input.url
        : input?.toString?.() ?? '';

    if (url.startsWith('https://store.steampowered.com/')) {
      throw new TypeError(`CORS blocked request to ${url}`);
    }

    const body = responses.get(url);
    if (!body) {
      throw new Error(`Unexpected fetch URL ${url}`);
    }
    return new Response(body, { status: 200 });
  });

  (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

  const bundles = await fetchBundleNames(appId);

  expect(bundles).toEqual([
    { id: '100', name: 'Proxy Tiny Bundle' },
    { id: '200', name: 'Proxy Town Bundle' },
  ]);

  const attemptedUrls = fetchMock.mock.calls.map(([input]) =>
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.href
      : input instanceof Request
      ? input.url
      : input?.toString?.() ?? ''
  );

  expect(attemptedUrls).toContain(directBundleListUrl);
  expect(attemptedUrls).toContain(proxyBundleListUrl);
  expect(attemptedUrls).toContain(directBundleUrl('100'));
  expect(attemptedUrls).toContain(proxyBundleUrl('100'));
});

test('fetchBundleNames extracts titles from sanitized markdown bundle pages', async () => {
  const { fetchBundleNames } = bundlesModule;

  const appId = '1337';
  const directBundleListUrl = `https://store.steampowered.com/bundlelist/${appId}`;
  const directBundleUrl = (bundleId: string) =>
    `https://store.steampowered.com/bundle/${bundleId}?l=english&cc=us`;
  const proxyBundleListUrl = `https://r.jina.ai/${directBundleListUrl}`;
  const proxyBundleUrl = (bundleId: string) => `https://r.jina.ai/${directBundleUrl(bundleId)}`;

  const bundleListHtml = `
    <a href="https://store.steampowered.com/bundle/54347"></a>
  `;

  const responses = new Map<string, string>([
    [proxyBundleListUrl, bundleListHtml],
    [`https://cors.isomorphic-git.org/${directBundleListUrl}`, bundleListHtml],
    [proxyBundleUrl('54347'), SANITIZED_BUNDLE_PAGE],
    [`https://cors.isomorphic-git.org/${directBundleUrl('54347')}`, SANITIZED_BUNDLE_PAGE],
  ]);

  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : input instanceof Request
        ? input.url
        : input?.toString?.() ?? '';

    if (url.startsWith('https://store.steampowered.com/')) {
      throw new TypeError(`CORS blocked request to ${url}`);
    }

    const body = responses.get(url);
    if (!body) {
      throw new Error(`Unexpected fetch URL ${url}`);
    }
    return new Response(body, { status: 200 });
  });

  (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

  const bundles = await fetchBundleNames(appId);

  expect(bundles).toEqual([
    { id: '54347', name: 'Save 22% on House Flipper 2 x Spray Paint Simulator on Steam' },
  ]);
});
