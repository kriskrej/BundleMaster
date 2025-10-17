import { fetchBundleNames } from './bundles';

const DEFAULT_APP_ID = '1190970';

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="app-container">
    <h1 class="title">Steam Bundle Analyzer</h1>
    <p class="subtitle">Wpisz AppID i kliknij „Analizuj”.</p>
    <div class="input-group">
      <input
        id="appid"
        class="appid-input"
        placeholder="np. ${DEFAULT_APP_ID}"
        value="${DEFAULT_APP_ID}"
      />
      <button id="go" class="analyze-button">Analizuj</button>
    </div>
    <pre id="out" class="output">Oczekiwanie na analizę…</pre>
  </div>
`;

const appIdInput = document.getElementById('appid') as HTMLInputElement;
const output = document.getElementById('out') as HTMLPreElement;

type Bundle = { id: string; name: string };

const formatBundles = (bundles: Bundle[]) => {
  if (!bundles.length) {
    return 'Brak bundli powiązanych z tą grą.';
  }

  return bundles
    .map((bundle, index) => `${index + 1}. ${bundle.name} (Bundle ${bundle.id})`)
    .join('\n');
};

const createLogger = (element: HTMLPreElement) => {
  let bundles: Bundle[] | null = null;
  let errorMessage: string | null = null;
  const logLines: string[] = [];

  const render = () => {
    const logsSection = logLines.length ? logLines.join('\n') : 'Brak logów.';
    const parts = [`Logi:`, logsSection, ''];

    if (errorMessage) {
      parts.push('Błąd:', errorMessage);
    } else {
      const bundleText = bundles ? formatBundles(bundles) : 'Oczekiwanie na wynik…';
      parts.push('Wynik:', bundleText);
    }

    element.textContent = parts.join('\n');
  };

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    logLines.push(`[${timestamp}] ${message}`);
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
    logLines.length = 0;
    render();
  };

  return { addLog, setBundles, setError, reset };
};

const logger = createLogger(output);

const analyze = async () => {
  const id = appIdInput.value.trim() || DEFAULT_APP_ID;
  appIdInput.value = id;
  logger.reset();
  logger.addLog(`Rozpoczynam analizę dla AppID ${id}.`);
  logger.addLog('Pobieranie danych o bundlach ze Steama…');

  try {
    const bundles = await fetchBundleNames(id);
    if (bundles.length) {
      logger.addLog(`Otrzymano ${bundles.length} bundli powiązanych z grą.`);
    } else {
      logger.addLog('Źródła nie zwróciły żadnych bundli dla tego AppID.');
    }
    logger.setBundles(bundles);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd';
    logger.addLog('Wystąpił błąd podczas pobierania bundli.');
    logger.setError(message);
  }
};

document.getElementById('go')!.addEventListener('click', analyze);

appIdInput.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    analyze();
  }
});
