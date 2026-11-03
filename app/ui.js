const token = location.hash.slice(1);
const form = document.querySelector('#settings');
const $ = selector => document.querySelector(selector);
let initialized = false;
let saved;
let state;
let clientList = [];
let dirty = false;
let busy = false;
let logsText = '';
let toastTimer;
let nextScanAt;
const statuses = { running: 'В работе', completed: 'Готово', waiting: 'Ожидание', skipped: 'Пропущен', paused: 'Пауза' };
const titles = { overview: ['Обзор', 'Панель управления', 'Игровые квесты, прогресс и автоматизация — в одном месте.'], settings: ['Настройки', 'Всё настроено под тебя.', 'Клиент Discord, интервалы работы и подключение.'], activity: ['Журнал', 'Каждое действие на виду.', 'Запуск процессов и фактические обновления от Discord.'] };
async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
}
function toast(message, error = false) {
    clearTimeout(toastTimer);
    $('#message').textContent = message;
    $('#message').classList.toggle('error', error);
    $('#message').hidden = false;
    toastTimer = setTimeout(() => { $('#message').hidden = true; }, error ? 8000 : 3500);
}
function navigate(page) {
    for (const button of document.querySelectorAll('[data-page]')) {
        button.classList.toggle('selected', button.dataset.page === page);
        if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    }
    for (const section of document.querySelectorAll('[data-view]')) section.hidden = section.dataset.view !== page;
    $('#page-name').textContent = titles[page][0];
    $('#page-title').textContent = titles[page][1];
    $('#page-description').textContent = titles[page][2];
}
for (const button of document.querySelectorAll('[data-page]')) button.addEventListener('click', () => navigate(button.dataset.page));
$('.brand').addEventListener('click', event => { event.preventDefault(); navigate('overview'); });
function readForm() {
    const values = {};
    for (const field of form.elements) {
        if (!field.name) continue;
        values[field.name] = field.type === 'checkbox' ? field.checked : field.type === 'number' ? Number(field.value) : field.value;
    }
    return values;
}
function setDirty(value) { dirty = value; $('#save-bar').hidden = !value; }
function populateClients(clients) {
    clientList = clients;
    const selectedPath = form.elements.discordPath.value;
    const select = $('#client-select');
    select.replaceChildren(new Option('Найти автоматически — рекомендуется', ''));
    for (const client of clients) select.add(new Option(`${client.label} — ${client.path}`, client.key));
    select.add(new Option('Указать путь вручную', '__manual__'));
    select.value = selectedPath ? clients.some(client => client.key === selectedPath) ? selectedPath : '__manual__' : '';
    $('#manual-path').hidden = select.value !== '__manual__';
    renderClient();
}
function renderClient() {
    const path = form.elements.discordPath.value;
    const selected = path ? clientList.find(client => client.key === path) : clientList[0];
    const found = Boolean(selected || path);
    $('#client-name').textContent = selected?.label || (path ? 'Свой клиент Discord' : 'Discord не найден');
    $('#client-path').textContent = selected?.path || path || 'Установи Discord или укажи путь в настройках';
    $('#client-path').title = selected?.path || path;
    $('#client-badge').textContent = selected ? path ? 'Выбран' : 'Найден автоматически' : path ? 'Ручной путь' : 'Нужна настройка';
    $('#client-badge').classList.toggle('warning', !found || selected?.kind === 'flatpak');
    $('#discovery-hint').textContent = selected?.kind === 'flatpak'
        ? 'Найден Flatpak. Изоляция клиента может мешать обнаружению процессов игр.'
        : clientsDescription();
}
function clientsDescription() {
    return clientList.length ? `Найдено установок: ${clientList.length}. При автоопределении используется первый подходящий клиент.`
        : 'Автопоиск не нашёл клиент. Можно указать путь вручную. Проверяется обычная установка, PTB и Canary.';
}
$('#client-select').addEventListener('change', () => {
    const selection = $('#client-select').value;
    $('#manual-path').hidden = selection !== '__manual__';
    if (selection !== '__manual__') form.elements.discordPath.value = selection;
    else { form.elements.discordPath.value = ''; form.elements.discordPath.focus(); }
    setDirty(true);
    renderClient();
});
form.addEventListener('input', () => { setDirty(true); renderClient(); });
form.addEventListener('change', event => { if (event.target.name) setDirty(true); });
async function detectClients() {
    const buttons = [$('#detect-client'), $('#rescan-settings')];
    buttons.forEach(button => button.disabled = true);
    try {
        const result = await api('/api/clients');
        populateClients(result.clients);
        toast(result.clients.length ? 'Discord найден. Путь вводить не нужно.' : 'Клиент не найден. Проверь установку Discord.', !result.clients.length);
    } catch (error) { toast(error.message, true); }
    finally { buttons.forEach(button => button.disabled = false); }
}
$('#detect-client').addEventListener('click', detectClients);
$('#rescan-settings').addEventListener('click', detectClients);
function populateSettings(settings) {
    saved = { ...settings };
    for (const [key, value] of Object.entries(settings)) {
        const field = form.elements.namedItem(key);
        if (!field) continue;
        if (field.type === 'checkbox') field.checked = value;
        else field.value = value;
    }
    populateClients(clientList);
    setDirty(false);
}
$('#discard').addEventListener('click', () => populateSettings(saved));
async function save() {
    if (busy || !initialized) return false;
    if (!form.checkValidity()) { navigate('settings'); form.reportValidity(); return false; }
    busy = true;
    $('#save-button').disabled = true;
    $('#run-button').disabled = true;
    try {
        const values = readForm();
        await api('/api/settings', { method: 'POST', body: JSON.stringify(values) });
        saved = { ...values };
        setDirty(false);
        toast(values.enabled ? 'Автоматизация включена. Подключаемся к Discord.' : 'Настройки сохранены. Выполнение выключено.');
        await refresh();
        return true;
    } catch (error) { toast(error.message, true); return false; }
    finally { busy = false; $('#save-button').disabled = false; $('#run-button').disabled = false; }
}
form.addEventListener('submit', event => { event.preventDefault(); save(); });
$('#run-button').addEventListener('click', async () => {
    form.elements.enabled.checked = !Boolean(state?.settings.enabled);
    setDirty(true);
    await save();
});
function minutes(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}
function renderQuests(quests) {
    const container = $('#quest-list');
    $('#quest-count').textContent = quests.length;
    if (!quests.length) {
        container.replaceChildren();
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        const title = document.createElement('h3');
        title.textContent = state.settings.enabled ? 'Ищем доступные квесты' : 'Здесь появятся твои квесты';
        const description = document.createElement('p');
        description.textContent = state.settings.enabled ? 'Дождись подключения к Discord. Подходящие задания появятся автоматически.' : 'Включи фоновый режим. Программа найдёт задания и покажет их прогресс.';
        empty.append(title, description);
        container.append(empty);
        return;
    }
    const order = { running: 0, waiting: 1, paused: 2, completed: 3, skipped: 4 };
    const fragment = document.createDocumentFragment();
    for (const quest of [...quests].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5))) {
        const row = document.createElement('article'); row.className = 'quest-row';
        const top = document.createElement('div'); top.className = 'quest-top';
        const avatar = document.createElement('span'); avatar.className = 'quest-avatar'; avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = String(quest.name || 'Q').split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
        const name = document.createElement('strong'); name.className = 'quest-title'; name.textContent = quest.name || 'Игровой квест';
        const badge = document.createElement('span'); badge.className = 'quest-state ' + (Object.hasOwn(statuses, quest.status) ? quest.status : 'paused'); badge.textContent = statuses[quest.status] || 'Ожидание';
        top.append(avatar, name, badge);
        const line = document.createElement('div'); line.className = 'progress-line';
        const progress = document.createElement('progress'); progress.max = Math.max(1, Number(quest.target) || 900); progress.value = Math.max(0, Number(quest.progress) || 0); progress.setAttribute('aria-label', `${quest.name}: ${minutes(quest.progress)} из ${minutes(quest.target)}`);
        const number = document.createElement('span'); number.className = 'progress-number'; number.textContent = `${minutes(quest.progress)} / ${minutes(quest.target)}`;
        line.append(progress, number); row.append(top, line);
        if (quest.reason && ['waiting', 'skipped'].includes(quest.status)) { const reason = document.createElement('p'); reason.className = 'quest-reason'; reason.textContent = quest.reason; row.append(reason); }
        fragment.append(row);
    }
    container.replaceChildren(fragment);
}
function renderLogs() {
    const filter = $('#log-search').value.toLocaleLowerCase();
    const log = $('#logs');
    const position = log.scrollTop;
    log.textContent = (filter ? logsText.split('\n').filter(line => line.toLocaleLowerCase().includes(filter)).join('\n') : logsText) || 'Пока нет записей.';
    log.scrollTop = $('#follow-logs').checked ? log.scrollHeight : position;
}
$('#log-search').addEventListener('input', renderLogs);
$('#follow-logs').addEventListener('change', renderLogs);
function updateCountdown() {
    if (!state?.settings.enabled) $('#next-scan').textContent = 'Пауза';
    else if (!nextScanAt) $('#next-scan').textContent = 'Скоро';
    else $('#next-scan').textContent = `${Math.max(0, Math.ceil((nextScanAt - Date.now()) / 1000))} с`;
}
async function refresh() {
    try {
        const next = await api('/api/status');
        state = next;
        clientList = next.clients || [];
        if (!initialized) { populateSettings(next.settings); initialized = true; }
        else renderClient();
        const connected = next.connection === 'connected';
        $('#platform').textContent = next.platform === 'win32' ? 'Windows' : 'Linux';
        const status = !next.settings.enabled ? 'На паузе' : connected ? 'Discord подключён' : next.connection === 'retrying' ? 'Повторное подключение' : 'Подключаемся к Discord';
        $('#status').textContent = status;
        $('#connection').classList.toggle('online', connected);
        $('#connection').classList.toggle('pending', next.settings.enabled && !connected);
        const quests = next.quests || [];
        $('#active-count').textContent = quests.filter(q => q.status === 'running').length;
        $('#complete-count').textContent = quests.filter(q => q.status === 'completed').length;
        nextScanAt = next.nextScanAt;
        updateCountdown();
        renderQuests(quests);
        logsText = next.logs || '';
        renderLogs();
        $('#updated').textContent = `Обновлено ${new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
        $('#run-button').disabled = busy;
        $('#run-button span').textContent = next.settings.enabled ? 'Приостановить' : 'Запустить';
        $('#run-button use').setAttribute('href', next.settings.enabled ? '#i-pause' : '#i-play');
        $('#compatibility-note').textContent = next.platform === 'linux' ? 'На Linux зачёт времени официально не поддерживается. Программа проверяет фактический прогресс у Discord.' : 'Награды забираются вручную в Discord. Одновременный запуск не гарантирует зачёт всех квестов.';
    } catch (error) {
        $('#status').textContent = 'Нет соединения с программой';
        $('#connection').classList.remove('online');
        $('#connection').classList.add('pending');
        if (!initialized) toast(error.message, true);
    }
}
$('#refresh').addEventListener('click', refresh);
navigate('overview');
refresh();
setInterval(refresh, 3000);
setInterval(updateCountdown, 1000);
