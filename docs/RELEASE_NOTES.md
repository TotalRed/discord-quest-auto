## English

**v0.2.1:** Windows fixes.
- Play quests are now actually credited on Windows: the native runner owns a small
  minimized window titled with the game executable. Discord's game detection ignored
  the previous windowless runner, so quests were accepted but stayed at 0:00.
- Connecting works when Discord is already running: the helper checks the debugging
  port first and, if Discord is open without it, restarts the client with the right
  flags (new **Restart Discord** setting, on by default).
- Clearer connection errors: "port never opened" vs "port open, main window not found"
  (with the page list).
- **Native Windows app.** `Discord Quest Auto.exe` (Tauri 2 + WebView2) replaces the
  browser tab: own window, tray icon (open / exit), close-to-tray, single instance,
  starts the agent itself; login startup opens it hidden in the tray. The Start menu
  shortcut and `Start.vbs` launch it. Linux uses an Edge/Chrome app window or the browser.

**v0.2.0:** new dark dashboard with quest cards and real progress, searchable
activity log, automatic Discord discovery on both platforms, client selection,
and manual fallback. Windows stable/PTB/Canary and Linux native/Snap/Flatpak
locations are detected. Flatpak process visibility still depends on its sandbox.

Preview builds for **Windows x64** and **Linux x64** with a bundled runtime,
local settings, background discovery, parallel runners, and optional login startup.
Extract the ZIP and open `Install.vbs` (Windows) or `Install.sh` (Linux).
Portable launchers are included. Execution and startup are off by default.

The README includes screenshots, setup, privacy details, and compatibility limits.
Native runner checks run on both platforms. Windows quest credit was confirmed on
v0.2.1. Rewards are claimed manually; Linux credit is not guaranteed.

## Русский

**v0.2.1:** исправления для Windows.
- Квесты на игру теперь реально засчитываются на Windows: runner открывает маленькое
  свёрнутое окно с именем exe игры. Прежний runner без окна детектор игр Discord
  не видел, поэтому квесты принимались, но висели на 0:00.
- Подключение работает, даже если Discord уже открыт: программа сначала проверяет
  отладочный порт и при необходимости перезапускает клиент с нужными параметрами
  (новая настройка «Перезапускать Discord», включена по умолчанию).
- Понятные ошибки подключения: «порт не открылся» или «порт открыт, но главное окно
  не найдено» (со списком страниц).
- **Нативное приложение для Windows.** `Discord Quest Auto.exe` (Tauri 2 + WebView2)
  вместо вкладки браузера: своё окно, иконка в трее (открыть / выход), закрытие
  в трей, один экземпляр, сам запускает агент; автозапуск открывает его сразу в трее.
  Ярлык в «Пуске» и `Start.vbs` запускают именно его. На Linux — окно Edge/Chrome
  в режиме приложения или браузер.

**v0.2.0:** новая тёмная панель с карточками и реальным прогрессом квестов,
поиск по журналу, автоматический поиск Discord на Windows и Linux, выбор клиента
и ручной путь. Windows: stable/PTB/Canary; Linux: обычные установки, Snap и Flatpak.
Видимость игровых процессов из Flatpak зависит от изоляции клиента.

Предварительная версия для **Windows x64** и **Linux x64**: среда запуска уже
в архиве, локальные настройки, поиск квестов в фоне, параллельные процессы
и автозапуск при входе в систему.
Распакуй ZIP и открой `Install.vbs` (Windows) или `Install.sh` (Linux).
Есть запуск без установки. Выполнение и автозапуск изначально выключены.

В README — скриншоты, инструкция, сведения о данных и ограничения.
Запуск runner проверяется на обеих платформах. Зачёт квестов на Windows
подтверждён в v0.2.1. Награды забираются вручную; зачёт на Linux не гарантируется.
