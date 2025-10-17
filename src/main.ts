const app = document.getElementById('app')!;
app.innerHTML = `
  <h1>Steam Bundle Analyzer</h1>
  <p>Wpisz AppID i kliknij „Analizuj”.</p>
  <input id="appid" placeholder="np. 1190970" />
  <button id="go">Analizuj</button>
  <pre id="out"></pre>
`;
document.getElementById('go')!.addEventListener('click', async () => {
  const id = (document.getElementById('appid') as HTMLInputElement).value.trim();
  (document.getElementById('out') as HTMLPreElement).textContent =
    id ? `TODO: fetch bundlelist/${id}` : 'Podaj AppID';
});
