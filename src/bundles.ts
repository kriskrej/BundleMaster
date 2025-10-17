const BUNDLE_LIST_URL = 'https://store.steampowered.com/bundlelist/';
const BUNDLE_PAGE_URL = 'https://store.steampowered.com/bundle/';
const BUNDLE_LINK_REGEX = /https?:\/\/store\.steampowered\.com\/bundle\/(\d+)/gi;

function isBrowserRuntime(): boolean {
  return typeof window !== 'undefined' && typeof window.document !== 'undefined';
}
const runtimeProxy = (() => {
  if (typeof import.meta !== 'undefined' && typeof (import.meta as any).env === 'object') {
    const raw = ((import.meta as any).env as { VITE_STEAM_PROXY?: string }).VITE_STEAM_PROXY;
    if (typeof raw === 'string' && raw.trim()) {
      return normalizeProxy(raw);
    }
  }

  if (typeof process !== 'undefined') {
    const fromProcess = process.env?.VITE_STEAM_PROXY ?? process.env?.STEAM_PROXY;
    if (typeof fromProcess === 'string' && fromProcess.trim()) {
      return normalizeProxy(fromProcess);
    }
  }

  return undefined;
})();

const FALLBACK_PROXIES = ['https://r.jina.ai/', 'https://cors.isomorphic-git.org/'].map(normalizeProxy);

const TITLE_REGEX = /<span class="title">([^<]+)<\/span>/i;
const BUNDLE_ANCHOR_REGEX = /<a[^>]*data-ds-bundleid="(\d+)"[^>]*data-ds-bundle-data="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

export interface BundleInfo {
  id: string;
  name: string;
}

export type BundleFetchLogLevel = 'info' | 'success' | 'warning' | 'error';

export interface BundleFetchReporter {
  log(message: string, level?: BundleFetchLogLevel): void;
  detail?(title: string, body: string): void;
}

export interface BundleFetchOptions {
  reporter?: BundleFetchReporter;
}

export async function fetchBundleNames(
  appId: string,
  options: BundleFetchOptions = {}
): Promise<BundleInfo[]> {
  const cleanId = appId.trim();
  if (!cleanId) {
    throw new Error('AppID is required');
  }

  const reporter = options.reporter;
  reporter?.log(`Normalizuję AppID: ${cleanId}`);

  const bundleIds = await fetchBundleIds(cleanId, reporter);
  if (!bundleIds.length) {
    reporter?.log('Nie znaleziono żadnych bundli powiązanych z tym AppID na stronie listy.', 'warning');
    return [];
  }

  reporter?.log(`Rozpoczynam pobieranie metadanych dla ${bundleIds.length} bundli.`);
  const bundles = await fetchBundleMetadata(bundleIds, reporter);
  const filtered = bundles.filter((bundle): bundle is BundleInfo => Boolean(bundle?.name.trim()));
  if (filtered.length !== bundles.length) {
    reporter?.log(
      `Odrzucono ${bundles.length - filtered.length} bundli bez nazwy po pobraniu metadanych.`,
      'warning'
    );
  }

  const unique = deduplicateBundles(filtered);
  if (unique.length !== filtered.length) {
    reporter?.log(
      `Usunięto ${filtered.length - unique.length} zduplikowanych wpisów bundli po scaleniu wyników.`,
      'warning'
    );
  }

  reporter?.log(`Zakończono pobieranie bundli. Łącznie ${unique.length} unikalnych pozycji.`, 'success');
  return unique;
}

export function extractBundlesFromHtml(html: string, appId: string): BundleInfo[] {
  BUNDLE_ANCHOR_REGEX.lastIndex = 0;
  const bundles: BundleInfo[] = [];
  const numericId = Number(appId);
  if (!Number.isFinite(numericId)) {
    return bundles;
  }

  let match: RegExpExecArray | null;
  while ((match = BUNDLE_ANCHOR_REGEX.exec(html)) !== null) {
    const [, bundleId, encodedData, anchorHtml] = match;
    const decodedData = decodeHtmlEntities(encodedData);
    let includesApp = false;

    try {
      const data = JSON.parse(decodedData);
      if (Array.isArray(data?.m_rgItems)) {
        includesApp = data.m_rgItems.some((item: any) => {
          const apps = Array.isArray(item?.m_rgIncludedAppIDs) ? item.m_rgIncludedAppIDs : [];
          return apps.includes(numericId);
        });
      }
    } catch (error) {
      continue;
    }

    if (!includesApp) {
      continue;
    }

    const titleMatch = TITLE_REGEX.exec(anchorHtml);
    if (!titleMatch) {
      continue;
    }
    const name = decodeHtmlEntities(titleMatch[1]).trim();
    if (!name) {
      continue;
    }

    bundles.push({ id: bundleId, name });
  }

  return deduplicateBundles(bundles);
}

async function fetchBundleIds(appId: string, reporter?: BundleFetchReporter): Promise<string[]> {
  const url = `${BUNDLE_LIST_URL}${encodeURIComponent(appId)}`;
  const { body } = await fetchTextFromSteam(url, 'listy bundli', reporter);
  const bundleIds = extractBundleIdsFromHtml(body);
  reporter?.log(
    `Wyodrębniono ${bundleIds.length} identyfikatorów bundli z kodu HTML listy.`
  );
  if (!bundleIds.length) {
    reporter?.log(
      'Strona listy bundli nie zawierała żadnych identyfikatorów powiązanych bundli.',
      'warning'
    );
    return [];
  }

  return bundleIds;
}

async function fetchBundleMetadata(
  bundleIds: string[],
  reporter?: BundleFetchReporter
): Promise<(BundleInfo | null)[]> {
  if (!bundleIds.length) {
    return [];
  }

  const limiter = createLimiter(4);
  let completed = 0;
  const total = bundleIds.length;

  return Promise.all(
    bundleIds.map((bundleId) =>
      limiter(async () => {
        reporter?.log(`Pobieranie danych dla bundla ${bundleId}.`);
        const bundleName = await fetchBundleName(bundleId, reporter);
        completed += 1;
        reporter?.log(`Postęp pobierania metadanych: ${completed}/${total}.`);
        if (!bundleName) {
          reporter?.log(
            `Nie udało się ustalić nazwy bundla ${bundleId} – brak nagłówka na stronie.`,
            'warning'
          );
          return null;
        }
        reporter?.log(`Zidentyfikowano bundla ${bundleId}: ${bundleName}.`, 'success');
        return { id: bundleId, name: bundleName };
      })
    )
  );
}

async function fetchBundleName(
  bundleId: string,
  reporter?: BundleFetchReporter
): Promise<string | null> {
  const url = `${BUNDLE_PAGE_URL}${encodeURIComponent(bundleId)}?l=english&cc=us`;
  const { body } = await fetchTextFromSteam(url, `strony bundla ${bundleId}`, reporter);
  const match = body.match(/<h2[^>]*class="pageheader"[^>]*>([^<]+)<\/h2>/i);
  if (!match) {
    reporter?.log(
      `Nie znaleziono elementu <h2 class="pageheader"> w treści bundla ${bundleId}.`,
      'warning'
    );
    return null;
  }
  return decodeHtmlEntities(match[1]).trim();
}

function createLimiter(limit: number) {
  if (!Number.isFinite(limit) || limit < 1) {
    return <T>(task: () => Promise<T>) => task();
  }

  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    while (active < limit && queue.length > 0) {
      const run = queue.shift();
      if (!run) {
        continue;
      }
      active += 1;
      run();
    }
  };

  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = () => {
        let result: Promise<T>;
        try {
          result = Promise.resolve(task());
        } catch (error) {
          active -= 1;
          next();
          reject(error);
          return;
        }

        result
          .then(resolve)
          .catch(reject)
          .finally(() => {
            active -= 1;
            next();
          });
      };

      queue.push(execute);
      next();
    });
  };
}

function deduplicateBundles(bundles: BundleInfo[]): BundleInfo[] {
  const seen = new Set<string>();
  return bundles.filter((bundle) => {
    if (seen.has(bundle.id)) {
      return false;
    }
    seen.add(bundle.id);
    return true;
  });
}

export function extractBundleIdsFromHtml(html: string): string[] {
  const seen = new Set<string>();

  const jsonMatch = html.match(/data-bundle_list="([^"]+)"/i);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as unknown;
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          const id = String(value).trim();
          if (id) {
            seen.add(id);
          }
        }
      }
    } catch (error) {
      throw new Error('Failed to parse bundle list from bundle list page', { cause: error });
    }
  }

  BUNDLE_LINK_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BUNDLE_LINK_REGEX.exec(html)) !== null) {
    const id = match[1]?.trim();
    if (id) {
      seen.add(id);
    }
  }

  return Array.from(seen);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

async function fetchTextFromSteam(
  url: string,
  resourceDescription: string,
  reporter?: BundleFetchReporter
): Promise<{ url: string; body: string }> {
  const attemptedUrls: AttemptRecord[] = [];
  const urlsToTry = [url, ...getProxyUrls(url)];

  reporter?.log(
    `Rozpoczynam pobieranie ${resourceDescription}. Dostępne adresy prób: ${urlsToTry.join(', ')}.`
  );

  for (let index = 0; index < urlsToTry.length; index += 1) {
    const candidateUrl = urlsToTry[index];
    const attemptNumber = index + 1;
    reporter?.log(`Próba ${attemptNumber}: ${candidateUrl}`);

    try {
      const response = await fetch(candidateUrl);
      if (!response.ok) {
        const statusError = new Error(
          `HTTP ${response.status} ${response.statusText || 'Unknown status'}`
        );
        attemptedUrls.push({ url: candidateUrl, error: statusError });
        reporter?.log(
          `Serwer zwrócił błąd dla ${resourceDescription} (${candidateUrl}): ${statusError.message}.`,
          'warning'
        );
        const body = await safeReadBody(response);
        if (body) {
          reporter?.detail?.(
            `Odpowiedź serwera (${resourceDescription}, próba ${attemptNumber})`,
            body
          );
        }
        continue;
      }

      const body = await response.text();
      reporter?.log(
        `Sukces: ${resourceDescription} pobrano podczas próby ${attemptNumber} (${candidateUrl}).`,
        'success'
      );
      reporter?.detail?.(
        `Odpowiedź serwera (${resourceDescription}, próba ${attemptNumber})`,
        body
      );
      return { url: candidateUrl, body };
    } catch (error) {
      attemptedUrls.push({ url: candidateUrl, error });
      reporter?.log(
        `Błąd sieci podczas próby ${attemptNumber} (${candidateUrl}): ${describeError(error)}.`,
        'warning'
      );
    }
  }

  reporter?.log(
    `Nie udało się pobrać ${resourceDescription} po ${attemptedUrls.length} próbach.`,
    'error'
  );

  const attemptsDescription = attemptedUrls
    .map((attempt, index) => `  ${index + 1}. ${attempt.url} → ${describeError(attempt.error)}`)
    .join('\n');

  throw new Error(
    `Failed to retrieve ${resourceDescription} from Steam after ${attemptedUrls.length} attempt(s):\n${attemptsDescription}`
  );
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return `Nie udało się odczytać treści odpowiedzi: ${describeError(error)}`;
  }
}

function getProxyUrls(url: string): string[] {
  if (!isBrowserRuntime()) {
    return [];
  }

  const proxies = runtimeProxy ? [runtimeProxy, ...FALLBACK_PROXIES] : FALLBACK_PROXIES;
  const seen = new Set<string>();

  return proxies
    .map((proxy) => proxy + url)
    .filter((candidate) => {
      if (seen.has(candidate)) {
        return false;
      }
      seen.add(candidate);
      return true;
    });
}

function normalizeProxy(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function describeError(error: unknown): string {
  if (!error) {
    return 'Unknown error';
  }
  if (error instanceof Error) {
    const cause = 'cause' in error ? (error as { cause?: unknown }).cause : undefined;
    const causeDescription = cause ? `; cause: ${describeError(cause)}` : '';
    return `${error.name}: ${error.message}${causeDescription}`;
  }
  return String(error);
}

interface AttemptRecord {
  url: string;
  error: unknown;
}
