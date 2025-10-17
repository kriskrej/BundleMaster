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

const formatBundles = (bundles: { id: string; name: string }[]) => {
  if (!bundles.length) {
    return 'Brak bundli powiązanych z tą grą.';
  }

  return bundles
    .map((bundle, index) => `${index + 1}. ${bundle.name} (Bundle ${bundle.id})`)
    .join('\n');
};

const analyze = async () => {
  const id = appIdInput.value.trim() || DEFAULT_APP_ID;
  appIdInput.value = id;
  output.textContent = 'Pobieranie danych o bundlach…';

  try {
    const bundles = await fetchBundleNames(id);
    output.textContent = formatBundles(bundles);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd';
    output.textContent = `Nie udało się pobrać bundli: ${message}`;
  }
};

document.getElementById('go')!.addEventListener('click', analyze);

appIdInput.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    analyze();
  }
});
