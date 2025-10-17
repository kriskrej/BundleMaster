import { beforeAll, afterEach, expect, test, vi } from 'vitest';

type BundlesModule = typeof import('./bundles');

const SAMPLE_HTML = `
<a data-ds-bundleid="123" data-ds-bundle-data="{&quot;m_rgItems&quot;:[{&quot;m_rgIncludedAppIDs&quot;:[111]}]}">
  <span class="title">Sample Bundle</span>
</a>
<a data-ds-bundleid="456" data-ds-bundle-data="{&quot;m_rgItems&quot;:[{&quot;m_rgIncludedAppIDs&quot;:[222]}]}">
  <span class="title">Other Bundle</span>
</a>`;

const SAMPLE_BUNDLE_PAGE_GAMES = `
  <a class="tab_item" data-ds-appid="111" data-ds-review-count="4321" data-ds-review-percentage="82" data-ds-price-final="1999">
    <div class="tab_item_name">Main Game</div>
    <img class="tab_item_cap_img" src="https://cdn.example.com/main.jpg" />
  </a>
  <a class="tab_item" data-ds-appid="777" data-ds-review-count="1234" data-ds-review-percentage="91" data-ds-price-final="1599">
    <div class="tab_item_name">Side Game</div>
    <img class="tab_item_cap_img" src="https://cdn.example.com/side.jpg" />
  </a>
`;

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

Items included in this bundle
[![Image 6](https://store.akamai.steamstatic.com/public/images/blank.gif)](https://store.steampowered.com/app/1190970/House_Flipper_2/?snr=1_430_4__431)
![Image 7](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1190970/acbf0f91bf304751429b34a1e8232157a961a449/capsule_184x69.jpg?t=1760690929)
-30%
$39.99
$27.99
House Flipper 2

[![Image 8](https://store.akamai.steamstatic.com/public/images/blank.gif)](https://store.steampowered.com/app/1811340/Spray_Paint_Simulator/?snr=1_430_4__431)
![Image 9](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1811340/f5c0aef21e46a5a449cd244328b78969030a3674/capsule_184x69.jpg?t=1749819588)
$14.99
Spray Paint Simulator

More like this
`;

const createBundlePage = (name: string, mainAppId: string, extraAppId: string) => `
  <h2 class="pageheader">${name}</h2>
  <a class="tab_item" data-ds-appid="${mainAppId}" data-ds-review-count="2222" data-ds-review-percentage="84" data-ds-price-final="2499">
    <div class="tab_item_name">${name} Base</div>
    <img class="tab_item_cap_img" src="https://cdn.example.com/${mainAppId}.jpg" />
  </a>
  <a class="tab_item" data-ds-appid="${extraAppId}" data-ds-review-count="555" data-ds-review-percentage="93" data-ds-price-final="1299">
    <div class="tab_item_name">${name} Extra</div>
    <img class="tab_item_cap_img" src="https://cdn.example.com/${extraAppId}.jpg" />
  </a>
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
  expect(result).toEqual([{ id: '123', name: 'Sample Bundle', games: [] }]);
});

test('extractBundleGamesFromHtml parses tab items with metadata', () => {
  const { extractBundleGamesFromHtml } = bundlesModule;
  const games = extractBundleGamesFromHtml(`<section>${SAMPLE_BUNDLE_PAGE_GAMES}</section>`);

  expect(games).toEqual([
    {
      appId: '111',
      name: 'Main Game',
      imageUrl: 'https://cdn.example.com/main.jpg',
      reviewCount: 4321,
      positiveReviewPercent: 82,
      priceUsd: 19.99,
    },
    {
      appId: '777',
      name: 'Side Game',
      imageUrl: 'https://cdn.example.com/side.jpg',
      reviewCount: 1234,
      positiveReviewPercent: 91,
      priceUsd: 15.99,
    },
  ]);
});

test('extractBundleGamesFromHtml parses sanitized markdown content when tab items are missing', () => {
  const { extractBundleGamesFromHtml } = bundlesModule;
  const games = extractBundleGamesFromHtml(SANITIZED_BUNDLE_PAGE);

  expect(games).toEqual([
    {
      appId: '1190970',
      name: 'House Flipper 2',
      imageUrl: 'https://steamcdn-a.akamaihd.net/steam/apps/1190970/capsule_184x69.jpg',
      reviewCount: null,
      positiveReviewPercent: null,
      priceUsd: null,
    },
    {
      appId: '1811340',
      name: 'Spray Paint Simulator',
      imageUrl: 'https://steamcdn-a.akamaihd.net/steam/apps/1811340/capsule_184x69.jpg',
      reviewCount: null,
      positiveReviewPercent: null,
      priceUsd: null,
    },
  ]);
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
    ['100', createBundlePage('Proxy Tiny Bundle', appId, '900')],
    ['200', createBundlePage('Proxy Town Bundle', appId, '901')],
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
    {
      id: '100',
      name: 'Proxy Tiny Bundle',
      games: [
        {
          appId: '900',
          name: 'Proxy Tiny Bundle Extra',
          imageUrl: 'https://cdn.example.com/900.jpg',
          reviewCount: 555,
          positiveReviewPercent: 93,
          priceUsd: 12.99,
        },
      ],
    },
    {
      id: '200',
      name: 'Proxy Town Bundle',
      games: [
        {
          appId: '901',
          name: 'Proxy Town Bundle Extra',
          imageUrl: 'https://cdn.example.com/901.jpg',
          reviewCount: 555,
          positiveReviewPercent: 93,
          priceUsd: 12.99,
        },
      ],
    },
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
    {
      id: '54347',
      name: 'Save 22% on House Flipper 2 x Spray Paint Simulator on Steam',
      games: [
        {
          appId: '1190970',
          name: 'House Flipper 2',
          imageUrl: 'https://steamcdn-a.akamaihd.net/steam/apps/1190970/capsule_184x69.jpg',
          reviewCount: null,
          positiveReviewPercent: null,
          priceUsd: null,
        },
        {
          appId: '1811340',
          name: 'Spray Paint Simulator',
          imageUrl: 'https://steamcdn-a.akamaihd.net/steam/apps/1811340/capsule_184x69.jpg',
          reviewCount: null,
          positiveReviewPercent: null,
          priceUsd: null,
        },
      ],
    },
  ]);
});

test('fetchBundleNames logs errors and continues when some bundle pages fail', async () => {
  const { fetchBundleNames } = bundlesModule;

  const appId = '5150';
  const bundleListHtml = `
    <a href="https://store.steampowered.com/bundle/100"></a>
    <a href="https://store.steampowered.com/bundle/200"></a>
  `;

  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : input instanceof Request
        ? input.url
        : input?.toString?.() ?? '';

    if (url.includes('bundlelist')) {
      return new Response(bundleListHtml, { status: 200 });
    }

    if (url.includes('bundle/100')) {
      throw new Error('Bundle 100 failure');
    }

    if (url.includes('bundle/200')) {
      return new Response(createBundlePage('Working Bundle', appId, '998'), { status: 200 });
    }

    throw new Error(`Unexpected fetch URL ${url}`);
  });

  (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

  const logs: Array<{ message: string; level?: string }> = [];

  const bundles = await fetchBundleNames(appId, {
    reporter: {
      log(message, level) {
        logs.push({ message, level });
      },
    },
  });

  expect(bundles).toEqual([
    {
      id: '200',
      name: 'Working Bundle',
      games: [
        {
          appId: '998',
          name: 'Working Bundle Extra',
          imageUrl: 'https://cdn.example.com/998.jpg',
          reviewCount: 555,
          positiveReviewPercent: 93,
          priceUsd: 12.99,
        },
      ],
    },
  ]);

  expect(logs.some((entry) => entry.level === 'error' && entry.message.includes('100'))).toBe(true);
});

test('fetchBundleNames reports progress updates while fetching bundles', async () => {
  const { fetchBundleNames } = bundlesModule;

  const appId = '9090';
  const bundleListHtml = `<a href="https://store.steampowered.com/bundle/300"></a>`;
  const bundlePageHtml = createBundlePage('Progress Bundle', appId, '301');

  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : input instanceof Request
        ? input.url
        : input?.toString?.() ?? '';

    if (url.includes('bundlelist')) {
      return new Response(bundleListHtml, { status: 200 });
    }

    if (url.includes('bundle/300')) {
      return new Response(bundlePageHtml, { status: 200 });
    }

    throw new Error(`Unexpected fetch URL ${url}`);
  });

  (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

  const progressUpdates: Array<{ current: number; total: number; message: string }> = [];

  await fetchBundleNames(appId, {
    reporter: {
      log() {},
      progress(update) {
        progressUpdates.push(update);
      },
    },
  });

  expect(progressUpdates.length).toBeGreaterThan(0);
  const lastUpdate = progressUpdates[progressUpdates.length - 1];
  expect(lastUpdate.current).toBe(lastUpdate.total);
  expect(typeof lastUpdate.message).toBe('string');
});
