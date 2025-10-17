import { fetchBundleNames, type BundleFetchReporter } from './bundles';

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

type Bundle = { id: string; name: string };
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
  let counter = 0;

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

  const renderDetails = () => {
    if (!detailEntries.length) {
      return '';
    }

    const items = detailEntries
      .map(
        (detail) => `
          <details class="detail-item">
            <summary>${escapeHtml(detail.timestamp)} — ${escapeHtml(detail.title)}</summary>
            <pre class="detail-body">${escapeHtml(detail.body)}</pre>
          </details>
        `
      )
      .join('');

    return `
      <section class="logger-section">
        <h2 class="section-title">Odpowiedzi serwera</h2>
        <div class="detail-list">${items}</div>
      </section>
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
      .map(
        (bundle) => `
          <li class="bundle-item">
            <span class="bundle-name">${escapeHtml(bundle.name)}</span>
            <span class="bundle-id">(#${escapeHtml(bundle.id)})</span>
          </li>
        `
      )
      .join('');

    return `<ol class="bundle-list">${items}</ol>`;
  };

  const render = () => {
    const logsMarkup = renderLogs();
    const detailsMarkup = renderDetails();
    const bundlesMarkup = renderBundles();

    element.innerHTML = `
      <section class="logger-section">
        <h2 class="section-title">Logi</h2>
        <div class="log-list">${logsMarkup}</div>
      </section>
      ${detailsMarkup}
      <section class="logger-section">
        <h2 class="section-title">Wynik</h2>
        ${bundlesMarkup}
      </section>
    `;
  };

  const addLog = (message: string, level: LogLevel) => {
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

  const setBundles = (bundleList: Bundle[]) => {
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
    counter = 0;
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
    detail: (title, body) => {
      logger.addDetail(title, body);
    },
  };

  try {
    const bundles = await fetchBundleNames(id, { reporter });
    if (bundles.length) {
      logger.logSuccess(`Otrzymano ${bundles.length} bundli powiązanych z grą.`);
    } else {
      logger.logWarning('Źródła nie zwróciły żadnych bundli dla tego AppID.');
    }
    logger.setBundles(bundles);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd';
    logger.logError('Wystąpił błąd podczas pobierania bundli.');
    logger.setError(message);
  }
};

document.getElementById('go')!.addEventListener('click', analyze);

appIdInput.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    analyze();
  }
});
