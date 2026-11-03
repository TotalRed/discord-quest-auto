const token = location.hash.slice(1);
const form = document.querySelector('form');
let initialized = false;
async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
}
async function refresh() {
    try {
        const state = await api('/api/status');
        document.querySelector('#status').textContent = `${state.platform === 'win32' ? 'Windows' : 'Linux'} · ${state.running ? 'Работает в фоне' : state.settings.enabled ? 'Ожидает повторного подключения' : 'Выполнение выключено'}`;
        if (!initialized) {
            for (const [key, value] of Object.entries(state.settings)) {
                const field = form.elements.namedItem(key);
                if (field.type === 'checkbox') field.checked = value;
                else field.value = value;
            }
            initialized = true;
        }
        const logs = document.querySelector('#logs');
        const atBottom = logs.scrollHeight - logs.scrollTop - logs.clientHeight < 60;
        logs.textContent = state.logs || 'Пока нет записей.';
        if (atBottom) logs.scrollTop = logs.scrollHeight;
    } catch (error) { document.querySelector('#status').textContent = error.message; }
}
form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
        const values = {};
        for (const field of form.elements) {
            if (!field.name) continue;
            values[field.name] = field.type === 'checkbox' ? field.checked : field.type === 'number' ? Number(field.value) : field.value;
        }
        await api('/api/settings', { method: 'POST', body: JSON.stringify(values) });
        document.querySelector('#message').textContent = 'Настройки применены.';
        await refresh();
    } catch (error) { document.querySelector('#message').textContent = error.message; }
    finally { button.disabled = false; }
});
refresh();
setInterval(refresh, 3000);
