# Decargo — комплексный аудит, октябрь 2026

Рабочий реестр: покрытие + находки. Обновляется по ходу работы, чтобы аудит
можно было продолжить без повторного изучения. Базовая версия: v3.36.0 (3852ce0).

Статусы покрытия: `не проверено` · `изучено` · `проблемы` · `исправлено` · `проверено` · `заблокировано`

## Карта проекта (фаза 1)

- **Стек:** Tauri v2.10 (Rust, WebView2) + vanilla JS ES-модули + Vite 6. Один HTML (`index.html`), один большой модуль `src/app.js` (~18.9k строк) + 25 вспомогательных модулей, CSS один файл (~18.3k строк).
- **Сборка:** `vite build` → `dist/`; `tauri build` (NSIS, per-user). CI: `.github/workflows/build-windows.yml` (push), `release.yml` (теги `v*`, подпись updater-бандла minisign, `latest.json`).
- **Rust-команды:** write_file, write_file_bytes, read_file, read_file_bytes, append_file_raw, ensure_dir, get/add_recent_file, outlook_scan (PowerShell), shared_read/commit/probe, computer_name, autosave_store/read, backups_list/read.
- **Плагины:** dialog, fs (в JS не используется), store, updater, process, shell, opener.
- **Данные:** план — localStorage (`current` + legacy `spicaTide_v13`) + durable autosave/backups в `%APPDATA%/com.spicatide.app` (v3.36); файлы `.spica`/`.json` (envelope `_schema:3`); общий план для двух ПК — `decargo-plan.json` в сетевой папке; облачная синхронизация CouchDB (`sync.js`).
- **Импорт:** Excel/CSV/PDF-манифесты (`manifestImport.js`, SheetJS, pdf.js, Tesseract OCR офлайн), Outlook-почта (`mailWatch.js` + PowerShell), камера палубы (`deckCamera.js`, `vision.js`, `liftReader.js`, ONNX OCR).
- **Экспорт:** PDF (jsPDF + html2canvas), Excel (SheetJS), JSON, печать через PDF.
- **Сеть:** Open-Meteo (погода/море/геокодинг), OSM/OpenSeaMap тайлы, GitHub (обновления).
- **UI:** собственные компоненты, CSS custom properties, `[data-theme="dark"]`, анимации CSS + `motion` (12.x), Performance mode, reduced motion.
- **Тесты:** автотестов в репозитории нет (кроме Rust unit-тестов shared_sync/store). Проверка — Playwright-харнесс в scratchpad с моделью Tauri.

## Реестр покрытия

| Область | Файлы | Статус | Кто |
| --- | --- | --- | --- |
| Rust / IPC / capabilities | src-tauri/** | не проверено | security |
| CSP, XSS-стоки, недоверенные данные | index.html, src/*.js | не проверено | security |
| CI / релиз / обновления | .github/workflows, tools | не проверено | security |
| Сохранение, загрузка, миграции, undo/redo | app.js (persistence) | изучено (3.36) | reliability |
| Синхронизация папка / облако | syncFolder.js, sync.js, syncHub.js | не проверено | reliability |
| Импорт манифестов / почты / камеры | manifestImport.js, mailWatch.js, deckCamera.js, vision.js, liftReader.js | не проверено | reliability + security |
| Геометрия палубы, единицы, размещение, DG | app.js (deck, DG) | не проверено | domain |
| Экспорт PDF / Excel ↔ модель | app.js (export) | не проверено | domain |
| Погода, карты | weather/*, fieldWeather.js, weatherMap.js, locMap.js | не проверено | reliability |
| Производительность | app.js render/drag | не проверено | performance |
| UI/UX: рабочее пространство, выбор/перетаскивание/масштаб | app.js, app.css | не проверено | ui |
| UI/UX: панели, диалоги, меню, состояния, тёмная тема, клавиатура | index.html, app.css | не проверено | ui |
| Анимации, reduced motion | motion.js, animations/*, app.css | не проверено | ui |
| Установщик, Windows-специфика | tauri.conf.json, NSIS | не проверено | security/windows |
| Устаревшее в репозитории | current-build/, source/, screenshots/, .playwright-mcp/ | не проверено | — |

## Находки

(заполняется: ID · область · статус · серьёзность · место · доказательство · причина · исправление · проверка)

### Источники
Отчёты проходов (scratchpad, не в репозитории): reliability.md (R-xx), domain.md (D-xx), performance.md (P-xx), ui/ui.md (U-xx, 149 скриншотов). Безопасность (S-xx) — проход выполнен вручную после сбоя субагента.

### Реестр (статус на старте исправлений)

| ID | Область | Сер. | Статус | Суть | Место |
| --- | --- | --- | --- | --- | --- |
| R-01 | Загрузка плана | крит. | подтв. | Битый план частично применяется, сохраняется и блокирует запуск (вечный splash) | app.js `_applyProjectData`, `loadPlan`, `_syncDoRestore`, `_syncApplyRemote` |
| S-01 | Безопасность | выс. | подтв. | CSP отключён (`csp:null`) при IPC с произвольными путями | tauri.conf.json |
| S-02 | Безопасность | выс. | подтв. | Неэкранированные данные из импорта/синхронизации в innerHTML (палитра команд, библиотека, локации, подсказка, зоны) | app.js 3612, 3914, 5879, 6457, 7146-7147, 7354, 7363, 14088-14123 |
| S-03 | Безопасность | ср. | подтв. | Плагин fs подключён и разрешён, но не используется | Cargo.toml, main.rs, capabilities |
| R-02 | Синхронизация папкой | выс. | подтв. | Конфликт без решения за 30 с перезаписывает план второго ПК | syncFolder.js 264-268, app.js 17425-17434, 17629-17636 |
| R-03/D-04 | Импорт | выс. | подтв. | Неверный разбор веса (запятые, кг/т, отрицательные) | manifestImport.js 118-126, app.js 9142 |
| R-04 | Сохранение | выс. | подтв. | Save/Save As/бэкапы теряют load list | app.js `_buildEnvelope` |
| R-05 | Синхронизация | выс. | подтв. | Undo/redo не уходят на второй ПК | app.js `_restoreSnapshot` |
| R-06 | Undo | выс. | подтв. | Undo размещения из очереди импорта удаляет груз совсем | app.js 8716, 10199 |
| D-01 | DG | выс. | подтв. | DG-груз в зоне NO DG CARGO не помечается | app.js `checkSeg` |
| D-02 | Мульти-судно | выс. | подтв. | План другого судна молча сдвигается при открытии | app.js 8208-8210, `loadPlan` |
| U-01 | UI | выс. | подтв. | В режиме Viewer пропадает красный ореол DG-конфликта | app.js renderAll |
| U-02 | UI | выс. | подтв. | Номер рейса обрезается без многоточия | app.css 17726, 17768 |
| U-03 | UI | выс. | подтв. | Клик по грузу перемасштабирует палубу, груз уезжает из-под курсора | app.js 8500-8521 |
| U-04 | UI | выс. | подтв. | Меню прозрачные при выключенном Performance mode | app.css 17942 |
| P-01..07 | Производительность | ср.-выс. | измер. | renderAll + 11 скрытых контролов на груз; CSS-переменные на `<html>`; `hfwFlow` грузит CPU в простое; FLIP-анимация полосы локаций на каждое изменение; DG-перетаскивание; checkSeg querySelector; шрифты 49% бандла | см. performance.md |
| R-07..21, D-03, D-05..13, U-05..26 | разное | ср./низ. | подтв./вопрос | см. отчёты | — |

### Исправлено в 3.37.0 (проверено)

| ID | Исправление | Проверка |
| --- | --- | --- |
| R-01 | `_validatePlan` + `_applyPlan` (снимок → применение → откат), единые для запуска, открытия, бэкапов, синхронизации, восстановления; битый план при запуске откладывается в `decargo_rejectedPlan`, предлагаются бэкапы | rel/t_boot.py, t_partial.py, t_restore.py — NOREPRO; t36 18/18 |
| R-02 | syncFolder: при отложенном локальном изменении удалённая версия не принимается, решает офицер; убран автоотказ через 30 с | rel/t_sync.py S1, S2 — NOREPRO |
| R-03/D-04 | `parseNumberLocale` + `parseWeightTonnes` (единица в ячейке → заголовок → эвристика), ASCO тоже | harness/wt.test.mjs 23/23 |
| R-04 | `_buildEnvelope` с loadList, `savePlan` использует его | rel/t_basic.py A1–A3, t_q.py A1b — NOREPRO |
| R-05 | `_restoreSnapshot` публикует на второй ПК | rel/t_sync.py S3 — NOREPRO |
| R-06 | очередь импорта в истории undo + `_historyRebaseQueue` | rel/t_queue.py IQ1 — NOREPRO |
| R-07 | пустые поля плана заменяют, а не наследуются | rel/t_basic.py B1, t_sync S4 — NOREPRO |
| R-08 | смена даты в полночь только для «сегодняшней» даты | код (часы не эмулировались повторно) |
| R-09 | бросок после undo/удалённого обновления двигает живой объект | rel/t_sync.py S5/S6 — повторить в след. прогоне |
| R-10 | сочетания без учёта регистра; Ctrl+Z в поле ввода не трогает план | rel/t_basic.py C1–C3, D1; t37 |
| R-12 | файловые IPC-команды асинхронные, лимит 50 МБ | cargo check/test |
| R-13 | отрицательный вес → 0; абсурдная геометрия отклоняется валидатором | rel/t_basic.py E1, F1 |
| R-14 (частично) | setMode при переполненном хранилище | — |
| D-01 | DG в зоне NO DG CARGO = конфликт (кроме LQ) | t37 |
| D-02 | судно плана переключается до размещения груза | код + t36 |
| D-03 | поворот длинномера поперёк палубы запрещён | t37 |
| U-01 | DG-обводка переустанавливается после renderAll | t37 |
| S-01 | CSP включён (без inline-скриптов: theme-boot.js вынесен в public/) | t37: 0 нарушений при запуске, палитре, экспорте PDF/Excel, импорте |
| S-02 | экранирование во всех найденных стоках | t37 (имя `<img onerror>` остаётся текстом) |
| S-03 | плагин fs удалён | cargo check |

### Производительность — исправлено (A/B: базовая 3.36 сборка :4190 против новой :4191, одинаковые условия, headless Chromium, 4x = замедление CPU)

| Сценарий | До | После |
| --- | --- | --- |
| Простой 10 с, 150 грузов (TaskDuration) | 0.926 с | 0.044 с (в 21 раз меньше) — причина: SMIL-анимация погодной иконки в шапке + `hfwFlow` |
| Цепочка удаления/броска, 400 грузов, 4x | 909 мс | 487 мс |
| checkSeg, 400 грузов, 4x | 95.5 мс | 15.8 мс |
| buildActiveLocStrip, 400, 4x | 60.5 мс | 3.3 мс |
| renderAll + стиль/раскладка, 400, 4x | 766 мс | 442 мс |
| Перетаскивание, 150, 4x, медиана кадра (не-DG / DG) | 50 / 66.6 мс | 16.7 / 16.7 мс |
| Длинные задачи при перетаскивании DG, 4x | 112 | 16 |
| Бросок (mouseup), 150, 4x | 854 мс | 393 мс |
| Шаг уменьшения масштаба ниже FIT, 150, 4x | 337–1523 мс | 2–22 мс |
| Основной JS-бандл | 3.94 МБ | 2.09 МБ (шрифты PDF грузятся при первом экспорте) |

Изменения: элементы управления выбором существуют только у выбранного груза (`display:none` + `@starting-style`); CSS-переменные не пишутся в `<html>` без изменения значения, `--vessel-bg-opacity` — на самом элементе, зерно палубы — прямо на `::before`; полоса локаций не перестраивается без изменений; FLIP читает стили до записи; DG-подсветка через карту id; зоны DG при перетаскивании строятся один раз; карточка DG не перерисовывается и не пищит повторно; иконка погоды-чип статичная, анимированное небо шапки останавливается в Performance mode / calm / off / reduced motion / фоне; `hfwFlow` на паузе в Performance mode (кроме наведения).
