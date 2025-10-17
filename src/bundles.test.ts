import process from 'node:process';
import { beforeAll, expect, test } from 'vitest';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { extractBundleIdsFromHtml, extractBundlesFromHtml, fetchBundleNames } from './bundles';

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

test('extractBundleIdsFromHtml handles sanitized markdown bundle list', () => {
  const ids = extractBundleIdsFromHtml(SANITIZED_BUNDLE_LIST);
  expect(ids).toEqual(['12345', '67890']);
});

test(
  'fetchBundleNames returns known bundles for House Flipper 2',
  { timeout: 30_000 },
  async () => {
    try {
      const bundles = await fetchBundleNames('1190970');
      expect(bundles.length).toBeGreaterThanOrEqual(5);

      const expectedNames = [
        'Tiny Flipper',
        'Town Flipper',
        'House Flipper Franchise Bundle',
      ];

      for (const name of expectedNames) {
        expect(bundles.some((bundle) => bundle.name === name)).toBe(true);
      }
    } catch (error) {
      throw new Error(createIntegrationErrorMessage(error));
    }
  }
);

function createIntegrationErrorMessage(error: unknown): string {
  const header = 'Unable to fetch bundles for app 1190970 during integration test.';
  if (error instanceof Error) {
    const pieces = [header, `Message: ${error.message}`];
    if (error.stack) {
      pieces.push('Stack trace:', indentLines(error.stack));
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause) {
      pieces.push('Cause:', indentLines(describe(cause)));
    }
    return pieces.join('\n');
  }
  return `${header}\nNon-error value thrown: ${String(error)}`;
}

function indentLines(value: string): string {
  return value
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function describe(value: unknown): string {
  if (value instanceof Error) {
    const cause = (value as { cause?: unknown }).cause;
    const causeDescription = cause ? `\nCause:\n${indentLines(describe(cause))}` : '';
    const stack = value.stack ? `\nStack:\n${indentLines(value.stack)}` : '';
    return `Error: ${value.message}${stack}${causeDescription}`;
  }
  return String(value);
}
