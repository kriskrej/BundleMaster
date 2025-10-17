import process from 'node:process';
import { beforeAll, expect, test } from 'vitest';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { extractBundlesFromHtml, fetchBundleNames } from './bundles';

const SAMPLE_HTML = `
<a data-ds-bundleid="123" data-ds-bundle-data="{&quot;m_rgItems&quot;:[{&quot;m_rgIncludedAppIDs&quot;:[111]}]}">
  <span class="title">Sample Bundle</span>
</a>
<a data-ds-bundleid="456" data-ds-bundle-data="{&quot;m_rgItems&quot;:[{&quot;m_rgIncludedAppIDs&quot;:[222]}]}">
  <span class="title">Other Bundle</span>
</a>`;

beforeAll(() => {
  const proxyUrl =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;

  if (proxyUrl) {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  }
});

test('extractBundlesFromHtml filters bundles by app id', () => {
  const result = extractBundlesFromHtml(SAMPLE_HTML, '111');
  expect(result).toEqual([{ id: '123', name: 'Sample Bundle' }]);
});

test(
  'fetchBundleNames returns more than five bundles for House Flipper 2',
  { timeout: 30_000 },
  async () => {
    const bundles = await fetchBundleNames('1190970');
    expect(bundles.length).toBeGreaterThan(5);
  }
);
