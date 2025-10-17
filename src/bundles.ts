const BUNDLE_LIST_URL = 'https://store.steampowered.com/bundlelist/';
const BUNDLE_PAGE_URL = 'https://store.steampowered.com/bundle/';
const BUNDLE_LINK_REGEX = /https?:\/\/store\.steampowered\.com\/bundle\/(\d+)/gi;
const BUNDLE_ITEM_REGEX =
  /<a\b([^>]*?)data-ds-appid="(\d+)"([^>]*)>([\s\S]*?)<\/a>/gi;

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

export interface BundleGameInfo {
  appId: string;
  name: string | null;
  imageUrl: string | null;
  reviewCount: number | null;
  positiveReviewPercent: number | null;
  priceUsd: number | null;
}

export interface BundleInfo {
  id: string;
  name: string;
  games: BundleGameInfo[];
}

export type BundleFetchLogLevel = 'info' | 'success' | 'warning' | 'error';

export interface BundleFetchProgress {
  current: number;
  total: number;
  message: string;
}

export interface BundleUpdateContext {
  isFinal: boolean;
}

export interface BundleFetchReporter {
  log(message: string, level?: BundleFetchLogLevel): void;
  detail?(title: string, body: string): void;
  progress?(update: BundleFetchProgress): void;
  bundles?(bundles: BundleInfo[], context: BundleUpdateContext): void;
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
  reporter?.progress?.({
    current: 0,
    total: 1,
    message: 'Pobieranie listy bundli…',
  });

  const bundleIds = await fetchBundleIds(cleanId, reporter);
  if (!bundleIds.length) {
    reporter?.log('Nie znaleziono żadnych bundli powiązanych z tym AppID na stronie listy.', 'warning');
    reporter?.progress?.({ current: 1, total: 1, message: 'Zakończono – brak bundli.' });
    return [];
  }

  reporter?.log(`Rozpoczynam pobieranie metadanych dla ${bundleIds.length} bundli.`);
  const totalProgress = 1 + bundleIds.length;
  let completedBundles = 0;
  reporter?.progress?.({
    current: 1,
    total: totalProgress,
    message: 'Przetwarzanie listy bundli…',
  });

  const bundleOrder = new Map<string, number>();
  bundleIds.forEach((bundleId, index) => {
    bundleOrder.set(bundleId, index);
  });

  const interimBundles = new Map<string, BundleInfo>();
  const emitBundles = (list: BundleInfo[], isFinal: boolean) => {
    if (!reporter?.bundles) {
      return;
    }
    const sorted = [...list].sort((a, b) => {
      const orderA = bundleOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const orderB = bundleOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });
    reporter.bundles(sorted, { isFinal });
  };

  const bundles = await fetchBundleMetadata(bundleIds, reporter, {
    onProgress: () => {
      completedBundles += 1;
      reporter?.progress?.({
        current: 1 + completedBundles,
        total: totalProgress,
        message: `Pobieranie szczegółów bundli: ${completedBundles}/${bundleIds.length}`,
      });
    },
    onBundle: (bundle) => {
      if (!bundle || !bundle.name.trim()) {
        return;
      }
      const sanitizedGames = deduplicateGames(bundle.games).filter((game) => game.appId !== cleanId);
      const sanitizedBundle: BundleInfo = {
        ...bundle,
        games: sanitizedGames,
      };
      interimBundles.set(sanitizedBundle.id, sanitizedBundle);
      if (interimBundles.size > 0) {
        emitBundles(Array.from(interimBundles.values()), false);
      }
    },
  });

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

  const sanitized = unique
    .map((bundle) => ({
      ...bundle,
      games: deduplicateGames(bundle.games).filter((game) => game.appId !== cleanId),
    }))
    .sort((a, b) => {
      const orderA = bundleOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const orderB = bundleOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });

  reporter?.log(`Zakończono pobieranie bundli. Łącznie ${sanitized.length} unikalnych pozycji.`, 'success');
  reporter?.progress?.({
    current: totalProgress,
    total: totalProgress,
    message: 'Zakończono pobieranie bundli.',
  });
  emitBundles(sanitized, true);
  return sanitized;
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

    bundles.push({ id: bundleId, name, games: [] });
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

interface BundleMetadataCallbacks {
  onProgress?: () => void;
  onBundle?: (bundle: BundleInfo | null) => void;
}

async function fetchBundleMetadata(
  bundleIds: string[],
  reporter?: BundleFetchReporter,
  callbacks: BundleMetadataCallbacks = {},
): Promise<(BundleInfo | null)[]> {
  if (!bundleIds.length) {
    return [];
  }

  const limiter = createLimiter(4);
  const { onProgress, onBundle } = callbacks;

  return Promise.all(
    bundleIds.map((bundleId) =>
      limiter(async () => {
        reporter?.log(`Pobieranie danych dla bundla ${bundleId}.`);
        let result: BundleInfo | null = null;
        try {
          result = await fetchBundleDetails(bundleId, reporter);
          if (!result) {
            reporter?.log(
              `Nie udało się ustalić nazwy bundla ${bundleId} – brak nagłówka na stronie.`,
              'warning'
            );
            return null;
          }
          reporter?.log(
            `Zidentyfikowano bundla ${bundleId}: ${result.name} (gry: ${result.games.length}).`,
            'success'
          );
          return result;
        } catch (error) {
          reporter?.log(
            `Nie udało się pobrać szczegółów bundla ${bundleId}: ${describeError(error)}.`,
            'error'
          );
          return null;
        } finally {
          if (result) {
            onBundle?.(result);
          }
          onProgress?.();
        }
      })
    )
  );
}

async function fetchBundleDetails(
  bundleId: string,
  reporter?: BundleFetchReporter,
): Promise<BundleInfo | null> {
  const url = `${BUNDLE_PAGE_URL}${encodeURIComponent(bundleId)}?l=english&cc=us`;
  const { body } = await fetchTextFromSteam(url, `strony bundla ${bundleId}`, reporter);
  const name = extractBundleTitle(body);
  if (!name) {
    reporter?.log(
      `Nie udało się ustalić tytułu bundla ${bundleId} w treści odpowiedzi.`,
      'warning'
    );
    return null;
  }
  const games = extractBundleGamesFromHtml(body);
  if (!games.length) {
    reporter?.log(
      `Strona bundla ${bundleId} nie zawierała dodatkowych gier lub nie udało się ich zidentyfikować.`,
      'warning'
    );
  }
  return { id: bundleId, name, games };
}

function extractBundleTitle(body: string): string | null {
  const patterns = [
    /<h2[^>]*class="pageheader"[^>]*>([^<]+)<\/h2>/i,
    /<title[^>]*>([^<]+)<\/title>/i,
    /^\s*Title:\s*(.+)$/im,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) {
      const value = decodeHtmlEntities(match[1]).trim();
      if (value) {
        return value;
      }
    }
  }

  const markdownMatch = body.match(/Markdown Content:\s*([\s\S]+)/i);
  if (markdownMatch) {
    const content = markdownMatch[1];
    const lines = content.split(/\r?\n/).map((line) => decodeHtmlEntities(line).trim());
    const firstLine = lines.find((line) => Boolean(line));
    if (firstLine) {
      return firstLine;
    }
  }

  return null;
}

export function extractBundleGamesFromHtml(html: string): BundleGameInfo[] {
  BUNDLE_ITEM_REGEX.lastIndex = 0;
  const games: BundleGameInfo[] = [];
  let match: RegExpExecArray | null;

  while ((match = BUNDLE_ITEM_REGEX.exec(html)) !== null) {
    const [, leadingAttributes, appId, trailingAttributes, innerHtml] = match;
    if (!appId) {
      continue;
    }
    const attributes = `${leadingAttributes ?? ''} ${trailingAttributes ?? ''}`;
    const name = extractGameName(innerHtml);
    const imageUrl = extractImageUrl(innerHtml);
    const reviewCount = parseIntegerAttribute(attributes, [
      'data-ds-review-count',
      'data-ds-reviewcount',
      'data-ds-review_count',
    ]);
    const positivePercent = parseIntegerAttribute(attributes, [
      'data-ds-review-percentage',
      'data-ds-reviewpercent',
      'data-ds-review_percent',
      'data-ds-reviewscore',
    ]);
    const priceUsd = parsePriceAttribute(attributes, [
      'data-ds-price-final',
      'data-ds-price',
      'data-ds-price-final-usd',
    ]);

    games.push({
      appId,
      name,
      imageUrl,
      reviewCount,
      positiveReviewPercent: positivePercent,
      priceUsd,
    });
  }

  if (games.length > 0) {
    return games;
  }

  const fallbackGames = extractBundleGamesFromSanitizedMarkdown(html);
  return fallbackGames;
}

function extractBundleGamesFromSanitizedMarkdown(html: string): BundleGameInfo[] {
  const markdownIndex = html.indexOf('Markdown Content:');
  const source = markdownIndex >= 0 ? html.slice(markdownIndex + 'Markdown Content:'.length) : html;

  const lines = source
    .split(/\r?\n/)
    .map((line) => decodeHtmlEntities(line).trim());

  if (!lines.length) {
    return [];
  }

  const startIndex = lines.findIndex((line) =>
    line.toLowerCase().includes('items included in this bundle')
  );
  const endIndex = lines.findIndex(
    (line, index) => index > startIndex && line.toLowerCase().startsWith('more like this')
  );

  const relevantLines =
    startIndex >= 0
      ? lines.slice(startIndex + 1, endIndex > startIndex ? endIndex : undefined)
      : lines;

  const appLinkRegex = /https?:\/\/store\.steampowered\.com\/app\/(\d+)\//i;
  const seen = new Set<string>();
  const games: BundleGameInfo[] = [];

  for (let index = 0; index < relevantLines.length; index += 1) {
    const line = relevantLines[index];
    const match = line.match(appLinkRegex);
    if (!match) {
      continue;
    }

    const appId = match[1];
    if (!appId || seen.has(appId)) {
      continue;
    }

    const name = extractNameFromSanitizedLines(relevantLines, index + 1);

    games.push({
      appId,
      name,
      imageUrl: `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/capsule_184x69.jpg`,
      reviewCount: null,
      positiveReviewPercent: null,
      priceUsd: null,
    });

    seen.add(appId);
  }

  return games;
}

function extractNameFromSanitizedLines(lines: string[], startIndex: number): string | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    const candidate = lines[index];
    if (!candidate) {
      continue;
    }

    const normalized = candidate.toLowerCase();

    if (
      candidate.startsWith('[') ||
      candidate.startsWith('!') ||
      candidate.startsWith('-') ||
      candidate.startsWith('+') ||
      candidate.startsWith('·') ||
      candidate.startsWith('•') ||
      candidate.startsWith('*') ||
      /^[$€£¥₽]/.test(candidate) ||
      /^-?\d/.test(candidate) ||
      normalized.includes('bundle discount') ||
      normalized.includes('bundle price') ||
      normalized.includes('add to cart') ||
      normalized.includes('buy this bundle') ||
      normalized.includes('view') ||
      normalized.includes('includes')
    ) {
      continue;
    }

    return candidate;
  }

  return null;
}

function extractGameName(innerHtml: string): string | null {
  const match = innerHtml.match(/class="[^\"]*tab_item_name[^\"]*"[^>]*>([^<]+)/i);
  if (match) {
    const value = decodeHtmlEntities(match[1]).trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function extractImageUrl(innerHtml: string): string | null {
  const match = innerHtml.match(
    /<img[^>]*class="[^"]*(?:tab_item_cap_img|bundle_capsule_image)[^"]*"[^>]*src="([^"]+)"/i,
  );
  if (match) {
    const value = decodeHtmlEntities(match[1]).trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function parseIntegerAttribute(source: string, names: string[]): number | null {
  for (const name of names) {
    const regex = new RegExp(`${name}\\s*=\\s*"([^"]+)"`, 'i');
    const match = source.match(regex);
    if (!match) {
      continue;
    }
    const parsed = parseInteger(match[1]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function parsePriceAttribute(source: string, names: string[]): number | null {
  for (const name of names) {
    const regex = new RegExp(`${name}\\s*=\\s*"([^"]+)"`, 'i');
    const match = source.match(regex);
    if (!match) {
      continue;
    }
    const parsed = parsePrice(match[1]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function parseInteger(rawValue: string | null | undefined): number | null {
  if (typeof rawValue !== 'string') {
    return null;
  }
  const sanitized = rawValue.replace(/[^\d-]/g, '');
  if (!sanitized) {
    return null;
  }
  const numeric = Number(sanitized);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function parsePrice(rawValue: string | null | undefined): number | null {
  if (typeof rawValue !== 'string') {
    return null;
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }
  const hasDecimalSeparator = trimmed.includes('.');
  const sanitized = trimmed.replace(/[^\d.]/g, '');
  if (!sanitized) {
    return null;
  }
  const numeric = Number(sanitized);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (hasDecimalSeparator) {
    return Math.round(numeric * 100) / 100;
  }
  return Math.round((numeric / 100) * 100) / 100;
}

function deduplicateGames(games: BundleGameInfo[]): BundleGameInfo[] {
  const seen = new Set<string>();
  return games.filter((game) => {
    if (seen.has(game.appId)) {
      return false;
    }
    seen.add(game.appId);
    return true;
  });
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
