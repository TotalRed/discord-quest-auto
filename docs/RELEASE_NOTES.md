## Русский

### Что нового в v0.2.1

**Квесты на Windows теперь реально засчитываются.**
- В v0.2.0 квесты принимались, но висели на 0:00: детектор игр Discord не видел
  runner без окна. Теперь runner держит окно с именем exe игры, и Discord
  засчитывает время. Проверено на реальных квестах.
- Окна runner спрятаны за краем экрана и не появляются на панели задач и в Alt+Tab,
  поэтому даже десяток параллельных квестов не засоряет панель.

**Отдельное приложение для Windows вместо вкладки браузера.**
- `Discord Quest Auto.exe` (Tauri 2 + WebView2): своё окно с панелью и иконка в трее.
- Закрытие окна прячет его в трей, квесты продолжаются. Клик по иконке или
  «Открыть панель» возвращает окно.
- «Выход (остановить квесты)» в меню трея останавливает агент и все runner.
- Только один экземпляр: повторный запуск ярлыка просто показывает окно.
- Приложение само запускает агент. Автозапуск при входе в Windows открывает его сразу в трее.
- Ярлык в «Пуске» и `Start.vbs` запускают приложение. Старая запись автозапуска
  (голый агент без окна) сама переключается на приложение при следующем старте.

**Подключение к Discord.**
- Если Discord уже открыт без отладочного порта, программа сама перезапустит его
  с нужными параметрами. Новая настройка «Перезапускать Discord» включена по умолчанию;
  перезапуск выкидывает из голосового канала.
- Понятные ошибки: «порт не открылся» или «порт открыт, но главное окно Discord
  не найдено» (со списком страниц).

**Linux:** панель открывается окном Edge/Chrome в режиме приложения, иначе в браузере.

### Как обновиться с v0.2.0

1. Выключи выполнение в старой версии (или закрой её агент).
2. Распакуй новый архив целиком и снова запусти `Install.vbs` (Windows) или `Install.sh` (Linux).
   Настройки и журнал сохранятся.

### Ограничения

Предварительная версия. Награды забираются вручную в Discord. Не все параллельные
квесты получают время одновременно. Видео, стримы и квесты из нескольких
обязательных действий не поддерживаются. Зачёт на Linux Discord официально не гарантирует.

## English

### What's new in v0.2.1

**Play quests are now actually credited on Windows.**
- In v0.2.0 quests were accepted but stayed at 0:00: Discord's game detection
  ignored the windowless runner. The runner now owns a window titled with the game
  executable, and Discord credits the time. Confirmed on real quests.
- Runner windows are parked off-screen and kept out of the taskbar and Alt+Tab,
  so a dozen parallel quests do not flood the taskbar.

**Native Windows app instead of a browser tab.**
- `Discord Quest Auto.exe` (Tauri 2 + WebView2): its own window with the panel and a tray icon.
- Closing the window hides it to the tray; quests keep running. Click the icon or
  **Open panel** to bring it back.
- **Exit (stop quests)** in the tray menu stops the agent and all runners.
- Single instance: opening the shortcut again just shows the window.
- The app starts the agent itself. Login startup opens it straight to the tray.
- The Start menu shortcut and `Start.vbs` launch the app. An existing login-startup
  entry (bare agent without a window) switches to the app on the next start.

**Connecting to Discord.**
- If Discord is already running without the debugging port, the helper restarts it
  with the right flags. New **Restart Discord** setting, on by default; restarting
  drops voice calls.
- Clearer errors: "port never opened" vs. "port open, but Discord's main window
  not found" (with the page list).

**Linux:** the panel opens as an Edge/Chrome app window, falling back to the browser.

### Updating from v0.2.0

1. Disable execution in the old version (or stop its agent).
2. Extract the new archive completely and run `Install.vbs` (Windows) or `Install.sh` (Linux) again.
   Settings and logs are kept.

### Limits

Preview release. Rewards are claimed manually in Discord. Parallel quests may not all
receive credit at the same time. Video, streaming and multi-step quests are not
supported. Discord does not officially support earning rewards on Linux.
