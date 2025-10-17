const APP_DETAILS_URL = 'https://store.steampowered.com/api/appdetails';
const SEARCH_URL =
  'https://store.steampowered.com/search/results/?query&start=0&count=50&dynamic_data=&sort_by=_ASC&snr=1_7_7_230_7&category1=996&force_infinite=1&l=english&cc=us&term=';

const isBrowserRuntime = typeof window !== 'undefined' && typeof window.document !== 'undefined';
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

const FALLBACK_PROXIES = ['https://cors.isomorphic-git.org/'].map(normalizeProxy);

const TITLE_REGEX = /<span class="title">([^<]+)<\/span>/i;
const BUNDLE_ANCHOR_REGEX = /<a[^>]*data-ds-bundleid="(\d+)"[^>]*data-ds-bundle-data="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

export interface BundleInfo {
  id: string;
  name: string;
}

export async function fetchBundleNames(appId: string): Promise<BundleInfo[]> {
  const cleanId = appId.trim();
  if (!cleanId) {
    throw new Error('AppID is required');
  }

  const appName = await fetchAppName(cleanId);
  const response = await fetchFromSteam(
    SEARCH_URL + encodeURIComponent(appName),
    'bundle search results'
  );
  const html = await response.text();
  return extractBundlesFromHtml(html, cleanId);
}

async function fetchAppName(appId: string): Promise<string> {
  const url = `${APP_DETAILS_URL}?appids=${encodeURIComponent(appId)}&cc=us&l=english`;
  const response = await fetchFromSteam(url, 'app details');
  const payload = await response.json();
  const entry = payload?.[appId];
  if (!entry?.success || !entry?.data?.name) {
    throw new Error(`Could not resolve app name for ${appId}`);
  }
  return entry.data.name as string;
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

async function fetchFromSteam(url: string, resourceDescription: string): Promise<Response> {
  const attemptedUrls: AttemptRecord[] = [];
  const urlsToTry = [url, ...getProxyUrls(url)];

  for (const candidateUrl of urlsToTry) {
    try {
      const response = await fetch(candidateUrl);
      if (!response.ok) {
        attemptedUrls.push({
          url: candidateUrl,
          error: new Error(`HTTP ${response.status} ${response.statusText || 'Unknown status'}`),
        });
        continue;
      }
      return response;
    } catch (error) {
      attemptedUrls.push({ url: candidateUrl, error });
    }
  }

  const attemptsDescription = attemptedUrls
    .map((attempt, index) => `  ${index + 1}. ${attempt.url} → ${describeError(attempt.error)}`)
    .join('\n');

  throw new Error(
    `Failed to retrieve ${resourceDescription} from Steam after ${attemptedUrls.length} attempt(s):\n${attemptsDescription}`
  );
}

function getProxyUrls(url: string): string[] {
  if (!isBrowserRuntime) {
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
