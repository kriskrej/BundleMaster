import { fetchBundleNames, type BundleFetchReporter, type BundleInfo } from './bundles';

const DEFAULT_APP_ID = '1190970';
const APP_VERSION = '1.1.0';

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="app-container">
    <header class="header">
      <div class="header-text">
        <h1 class="title">Steam Bundle Analyzer</h1>
        <p class="subtitle">Wpisz AppID i kliknij „Analizuj”.</p>
      </div>
      <span class="version-badge">v${APP_VERSION}</span>
    </header>
    <div class="input-group">
      <input
        id="appid"
        class="appid-input"
        placeholder="np. ${DEFAULT_APP_ID}"
        value="${DEFAULT_APP_ID}"
      />
      <button id="go" class="analyze-button">Analizuj</button>
    </div>
    <div id="out" class="output"></div>
  </div>
`;

const appIdInput = document.getElementById('appid') as HTMLInputElement;
const output = document.getElementById('out') as HTMLDivElement;

type BundleGame = {
  appId: string;
  name: string | null;
  imageUrl: string | null;
  reviewCount: number | null;
  positiveReviewPercent: number | null;
  priceUsd: number | null;
};

type Bundle = { id: string; name: string; games: BundleGame[] };
type LogLevel = 'info' | 'success' | 'warning' | 'error';

type LogEntry = {
  id: number;
  timestamp: string;
  level: LogLevel;
  message: string;
};

type DetailEntry = {
  id: number;
  timestamp: string;
  title: string;
  body: string;
};

type ProgressState = {
  current: number;
  total: number;
  message: string;
};

const formatNumber = (value: number | null) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('pl-PL')
    : 'Brak danych';

const formatPercentage = (value: number | null) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value}%`
    : 'Brak danych';

const formatPrice = (value: number | null) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `$${value.toFixed(2)}`
    : 'Brak danych';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatText = (value: string) => escapeHtml(value).replace(/\n/g, '<br />');

const createLogger = (element: HTMLDivElement) => {
  let bundles: Bundle[] | null = null;
  let errorMessage: string | null = null;
  let logEntries: LogEntry[] = [];
  let detailEntries: DetailEntry[] = [];
  let progress: ProgressState | null = null;
  let counter = 0;
  let lastLogKey: string | null = null;
  const detailKeys = new Set<string>();

  const renderLogs = () => {
    if (!logEntries.length) {
      return '<div class="log-empty">Brak logów.</div>';
    }

    return logEntries
      .map((entry) => {
        const classes = `log-entry log-entry--${entry.level}`;
        return `
          <div class="${classes}">
            <span class="log-timestamp">[${escapeHtml(entry.timestamp)}]</span>
            <span class="log-message">${formatText(entry.message)}</span>
          </div>
        `;
      })
      .join('');
  };

  const renderDetailItems = () =>
    detailEntries
      .map(
        (detail) => `
          <details class="detail-item">
            <summary>${escapeHtml(detail.timestamp)} — ${escapeHtml(detail.title)}</summary>
            <pre class="detail-body">${escapeHtml(detail.body)}</pre>
          </details>
        `
      )
      .join('');

  const renderProgress = () => {
    if (!progress) {
      return '';
    }
    const total = progress.total > 0 ? progress.total : 1;
    const ratio = Math.max(0, Math.min(1, progress.current / total));
    const percent = Math.round(ratio * 100);
    return `
      <section class="logger-section">
        <div class="progress">
          <div class="progress__header">
            <h2 class="section-title section-title--compact">Postęp</h2>
            <span class="progress__value">${percent}%</span>
          </div>
          <div class="progress__bar">
            <div class="progress__bar-fill" style="width: ${percent}%;"></div>
          </div>
          <p class="progress__message">${escapeHtml(progress.message)}</p>
        </div>
      </section>
    `;
  };

  const renderBundleGame = (game: BundleGame) => {
    const name = game.name ? escapeHtml(game.name) : `Aplikacja #${escapeHtml(game.appId)}`;
    const imageMarkup = game.imageUrl
      ? `<img class="bundle-game__image" src="${escapeHtml(game.imageUrl)}" alt="${name}" loading="lazy" />`
      : `<div class="bundle-game__image bundle-game__image--empty">Brak miniatury</div>`;

    return `
      <li class="bundle-game">
        <div class="bundle-game__thumb">${imageMarkup}</div>
        <div class="bundle-game__content">
          <div class="bundle-game__title">${name} <span class="bundle-game__appid">(#${escapeHtml(
            game.appId,
          )})</span></div>
          <div class="bundle-game__stats">
            <span class="bundle-game__stat">Recenzje: ${formatNumber(game.reviewCount)}</span>
            <span class="bundle-game__stat">Pozytywne: ${formatPercentage(
              game.positiveReviewPercent,
            )}</span>
            <span class="bundle-game__stat">Cena: ${formatPrice(game.priceUsd)}</span>
          </div>
        </div>
      </li>
    `;
  };

  const renderBundles = () => {
    if (errorMessage) {
      return `<div class="result result--error">${formatText(errorMessage)}</div>`;
    }

    if (!bundles) {
      return '<div class="result result--pending">Oczekiwanie na wynik…</div>';
    }

    if (!bundles.length) {
      return '<div class="result result--empty">Brak bundli powiązanych z tą grą.</div>';
    }

    const items = bundles
      .map((bundle) => {
        const gamesMarkup = bundle.games.length
          ? `<ul class="bundle-game-list">${bundle.games.map(renderBundleGame).join('')}</ul>`
          : '<div class="bundle-game-list bundle-game-list--empty">Brak dodatkowych gier w tym bundlu.</div>';

        return `
          <li class="bundle-item">
            <div class="bundle-header">
              <span class="bundle-name">${escapeHtml(bundle.name)}</span>
              <span class="bundle-id">(#${escapeHtml(bundle.id)})</span>
            </div>
            ${gamesMarkup}
          </li>
        `;
      })
      .join('');

    return `<ol class="bundle-list">${items}</ol>`;
  };

  const updateProgress = (value: ProgressState | null) => {
    if (!value) {
      progress = null;
      render();
      return;
    }

    const total = Math.max(1, value.total);
    const current = Math.max(0, Math.min(value.current, total));
    const message = value.message.trim();
    const next: ProgressState = {
      current,
      total,
      message: message || 'Przetwarzanie w toku…',
    };

    const isSame =
      progress &&
      progress.current === next.current &&
      progress.total === next.total &&
      progress.message === next.message;

    if (!isSame) {
      progress = next;
      render();
    }
  };

  const render = () => {
    const previousStates = new Map<string, boolean>();
    element
      .querySelectorAll<HTMLDetailsElement>('[data-section]')
      .forEach((detailsElement) => {
        const key = detailsElement.dataset.section;
        if (key) {
          previousStates.set(key, detailsElement.open);
        }
      });

    const logsMarkup = renderLogs();
    const detailsMarkup =
      detailEntries.length > 0
        ? `
      <section class="logger-section">
        <details class="collapsible" data-section="responses" ${
          previousStates.get('responses') ? 'open' : ''
        }>
          <summary class="collapsible__summary">
            <span class="section-title">Odpowiedzi serwera</span>
            <span class="collapsible__badge">${detailEntries.length}</span>
          </summary>
          <div class="detail-list">${renderDetailItems()}</div>
        </details>
      </section>
    `
        : '';
    const progressMarkup = renderProgress();
    const bundlesMarkup = renderBundles();

    element.innerHTML = `
      <section class="logger-section">
        <details class="collapsible" data-section="logs" ${
          previousStates.get('logs') ? 'open' : ''
        }>
          <summary class="collapsible__summary">
            <span class="section-title">Logi</span>
            <span class="collapsible__badge">${logEntries.length}</span>
          </summary>
          <div class="log-list">${logsMarkup}</div>
        </details>
      </section>
      ${detailsMarkup}
      ${progressMarkup}
      <section class="logger-section">
        <h2 class="section-title">Wynik</h2>
        ${bundlesMarkup}
      </section>
    `;
  };

  const addLog = (message: string, level: LogLevel) => {
    const logKey = `${level}::${message}`;
    if (lastLogKey === logKey) {
      return;
    }

    lastLogKey = logKey;
    logEntries = [
      ...logEntries,
      {
        id: ++counter,
        timestamp: new Date().toLocaleTimeString(),
        level,
        message,
      },
    ];
    render();
  };

  const addDetail = (title: string, body: string) => {
    const detailKey = `${title}::${body}`;
    if (detailKeys.has(detailKey)) {
      return;
    }

    detailKeys.add(detailKey);
    detailEntries = [
      ...detailEntries,
      {
        id: ++counter,
        timestamp: new Date().toLocaleTimeString(),
        title,
        body,
      },
    ];
    render();
  };

  const setBundles = (bundleList: Bundle[], options: { isFinal?: boolean } = {}) => {
    const { isFinal = false } = options;
    if (!isFinal && bundleList.length === 0) {
      return;
    }

    bundles = bundleList;
    errorMessage = null;
    render();
  };

  const setError = (message: string) => {
    bundles = null;
    errorMessage = message;
    render();
  };

  const reset = () => {
    bundles = null;
    errorMessage = null;
    logEntries = [];
    detailEntries = [];
    progress = null;
    counter = 0;
    lastLogKey = null;
    detailKeys.clear();
    render();
  };

  render();

  return {
    logInfo: (message: string) => addLog(message, 'info'),
    logSuccess: (message: string) => addLog(message, 'success'),
    logWarning: (message: string) => addLog(message, 'warning'),
    logError: (message: string) => addLog(message, 'error'),
    addDetail,
    setBundles,
    setError,
    setProgress: updateProgress,
    reset,
  };
};

const logger = createLogger(output);

const analyze = async () => {
  const id = appIdInput.value.trim() || DEFAULT_APP_ID;
  appIdInput.value = id;
  logger.reset();
  logger.logInfo(`Rozpoczynam analizę dla AppID ${id}.`);
  logger.logInfo('Pobieranie danych o bundlach ze Steama…');

  const reporter: BundleFetchReporter = {
    log: (message, level = 'info') => {
      switch (level) {
        case 'success':
          logger.logSuccess(message);
          break;
        case 'warning':
          logger.logWarning(message);
          break;
        case 'error':
          logger.logError(message);
          break;
        default:
          logger.logInfo(message);
      }
    },
    bundles: (bundleList: BundleInfo[], context) => {
      const normalizedBundles: Bundle[] = bundleList.map((bundle) => ({
        id: bundle.id,
        name: bundle.name,
        games: bundle.games.map((game) => ({ ...game })),
      }));
      logger.setBundles(normalizedBundles, { isFinal: context.isFinal });
    },
    detail: (title, body) => {
      logger.addDetail(title, body);
    },
    progress: (info) => {
      logger.setProgress(info);
    },
  };

  try {
    const bundles = await fetchBundleNames(id, { reporter });
    if (bundles.length) {
      logger.logSuccess(`Otrzymano ${bundles.length} bundli powiązanych z grą.`);
    } else {
      logger.logWarning('Źródła nie zwróciły żadnych bundli dla tego AppID.');
    }
    logger.setBundles(bundles, { isFinal: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd';
    logger.logError('Wystąpił błąd podczas pobierania bundli.');
    logger.setError(message);
  } finally {
    logger.setProgress(null);
  }
};

document.getElementById('go')!.addEventListener('click', analyze);

appIdInput.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    analyze();
  }
});
