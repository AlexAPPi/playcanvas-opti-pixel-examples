export type Lang = 'ru' | 'en';

const ru = {
    language: 'Язык',
    sectionMode: 'Режим',
    sectionObjects: 'Управление объектами',
    sectionBuffer: 'CoverageBuffer',
    sectionDebug: 'Отладка',
    device: 'Устройство',
    deviceAuto: 'Авто',
    tester: 'Тест',
    testerOff: 'Выкл',
    hzbRenderer: 'Рендер HZB',
    hzbRendererTitle: 'Как WebGPU строит пирамиду HZB',
    hzbRendererUnavailable: 'Compute и pixel доступны только для пирамиды HZB на WebGPU',
    depth: 'Глубина',
    depthTitle: 'Откуда HZB берёт глубину сцены',
    encoding: 'Кодирование',
    encodingTitle: 'Linear — метры в R32F. Packed — RGBA8, если float render target недоступен. Reciprocal — 1/viewZ. Depth grab всегда device Z.',
    encodingCameraFrame: 'Linear — метры в R32F. Packed — RGBA8, его пишет prepass без float render target. Reciprocal — 1/viewZ',
    encodingDepthGrab: 'Depth grab всегда отдаёт device Z',
    capacity: 'Количество',
    radius: 'Радиус',
    coverageWidth: 'Ширина буфера',
    coverageWidthTitle: 'Потолок ширины карты Coverage, в текселях. Скачанный размер показан в статистике.',
    coverageHeight: 'Высота буфера',
    coverageHeightTitle: 'Потолок высоты карты Coverage, в текселях. Скачанный размер показан в статистике.',
    minReadbackLag: 'minReadbackLag',
    minReadbackLagTitle: 'Сколько вызовов frameUpdate ждать, прежде чем скопировать готовое скачивание на CPU. 0 — сразу, как готово. По умолчанию 2.',
    readbackSlots: 'readbackSlots',
    readbackSlotsTitle: 'Сколько чтений GPU→CPU держать в полёте. Минимум 2, по умолчанию 5. Смена сбрасывает ещё не дошедшие скачивания.',
    readbackPeriod: 'readbackPeriod',
    readbackPeriodTitle: 'Упаковывать карту каждый N-й заход, пока есть свободный слот. Сбор идёт каждый кадр. Только WebGL, по умолчанию 1.',
    cpuReadback: 'cpuReadback',
    cpuReadbackTitle: 'Когда выключено, capture не пакует карту и не начинает чтение. Уже запущенное чтение всё равно публикуется.',
    autoUpdate: 'Автообновление',
    showBuffer: 'Показать буфер',
    showBufferTitle: 'Пирамида HZB или карты Coverage',
    debugObject: 'Отладка объекта',
    mipFullscreen: 'Mip на весь экран',
    map: 'Карта',
    mapTitle: 'Что показать на весь экран: перепроекция текущего кадра или скачанный буфер',
    reprojected: 'Перепроекция',
    downloaded: 'Скачанный',
    mipLevel: 'Уровень mip',
    mipOpacity: 'Непрозрачность mip',
    mipOpacityTitle: 'Непрозрачность отладки mip и буфера. 1 — сплошная, 0 — прозрачная',
    starting: 'Запуск…',
    bootFailed: 'Не удалось запустить сцену',
    markupMissing: 'Не найдена разметка приложения',
    controlsTouch: 'Левый стик — движение, правый — обзор. +/− — соседний объект отладки.',
    controlsMouse: 'ПКМ — обзор, СКМ — сдвиг, WASD — движение, Shift — быстрее, Пробел — медленнее. C — объект отладки, +/- — соседний, B — бокс, R — рамка.',
    debugMipHzb: 'Показать выбранный mip HZB на весь экран',
    debugMipDownloaded: 'Показать скачанный буфер Coverage на весь экран',
    debugMipReprojected: 'Показать перепроецированную карту Coverage на весь экран',
    pyramidRenderer: 'пирамида {renderer}',
    pyramidHzb: 'пирамида HZB',
    hintCoverage: 'Coverage ({pyramid}, {depth}) пакует mip в view Z и проверяет объекты на CPU.',
    hintQueries: 'Queries возвращает видимость на CPU.',
    hintHzbGpu: 'HZB ({renderer}, {depth}) отсекает объекты через indirect draw.',
    hintHzbCpu: 'HZB ({depth}) возвращает видимость на CPU.',
    hintOff: 'Тест выключен: объекты отсекаются только фрустумом.',
    modeOff: 'выкл',
    statsBuffer: ' · буфер {width}×{height}',
    statsReading: ' · чтение',
    statsObject: ' · объект {index}',
    statsLine: '{device} · {mode}{coverage} · {depth} · в кадре {visible} / {total}{warming}{debug}',
    joystickMove: 'Движение',
    joystickLook: 'Обзор',
    debugNext: 'Следующий объект',
    debugPrev: 'Предыдущий объект',
} as const;

export type MessageKey = keyof typeof ru;

const en: { [K in MessageKey]: string } = {
    language: 'Language',
    sectionMode: 'Mode',
    sectionObjects: 'Object control',
    sectionBuffer: 'CoverageBuffer',
    sectionDebug: 'Debug',
    device: 'Device',
    deviceAuto: 'Auto',
    tester: 'Test',
    testerOff: 'Off',
    hzbRenderer: 'HZB render',
    hzbRendererTitle: 'How WebGPU builds the HZB pyramid',
    hzbRendererUnavailable: 'Compute and pixel are available only for the HZB pyramid on WebGPU',
    depth: 'Depth',
    depthTitle: 'Where HZB reads scene depth',
    encoding: 'Encoding',
    encodingTitle: 'Linear — meters in R32F. Packed — RGBA8 when a float render target is unavailable. Reciprocal — 1/viewZ. Depth grab is always device Z.',
    encodingCameraFrame: 'Linear — meters in R32F. Packed — RGBA8, written by the prepass without a float render target. Reciprocal — 1/viewZ',
    encodingDepthGrab: 'Depth grab always returns device Z',
    capacity: 'Count',
    radius: 'Radius',
    coverageWidth: 'Buffer width',
    coverageWidthTitle: 'Cap on the Coverage map width, in texels. The downloaded size is shown in the stats.',
    coverageHeight: 'Buffer height',
    coverageHeightTitle: 'Cap on the Coverage map height, in texels. The downloaded size is shown in the stats.',
    minReadbackLag: 'minReadbackLag',
    minReadbackLagTitle: 'How many frameUpdate calls to wait before copying a finished download to the CPU. 0 copies as soon as it is ready. Default 2.',
    readbackSlots: 'readbackSlots',
    readbackSlotsTitle: 'How many GPU→CPU reads can be in flight. Minimum 2, default 5. Changing this drops downloads that have not landed.',
    readbackPeriod: 'readbackPeriod',
    readbackPeriodTitle: 'Pack a capture every Nth attempt while a slot is free. Harvest still runs every frame. WebGL only, default 1.',
    cpuReadback: 'cpuReadback',
    cpuReadbackTitle: 'When off, capture does not pack or start a readback. A readback already in flight is still published.',
    autoUpdate: 'Auto update',
    showBuffer: 'Show buffer',
    showBufferTitle: 'HZB pyramid or Coverage maps',
    debugObject: 'Debug object',
    mipFullscreen: 'Fullscreen mip',
    map: 'Map',
    mapTitle: 'What to show fullscreen: the current frame reprojection or the downloaded buffer',
    reprojected: 'Reprojected',
    downloaded: 'Downloaded',
    mipLevel: 'Mip level',
    mipOpacity: 'Mip opacity',
    mipOpacityTitle: 'Opacity of the mip and buffer debug view. 1 is solid, 0 is clear.',
    starting: 'Starting…',
    bootFailed: 'Failed to start the scene',
    markupMissing: 'App markup was not found',
    controlsTouch: 'Left stick — move, right stick — look. +/− — neighboring debug object.',
    controlsMouse: 'Right mouse — look, middle mouse — pan, WASD — move, Shift — faster, Space — slower. C — debug object, +/- — neighbor, B — box, R — frame.',
    debugMipHzb: 'Show the selected HZB mip fullscreen',
    debugMipDownloaded: 'Show the downloaded Coverage buffer fullscreen',
    debugMipReprojected: 'Show the reprojected Coverage map fullscreen',
    pyramidRenderer: '{renderer} pyramid',
    pyramidHzb: 'HZB pyramid',
    hintCoverage: 'Coverage ({pyramid}, {depth}) packs the mip into view Z and tests objects on the CPU.',
    hintQueries: 'Queries returns visibility on the CPU.',
    hintHzbGpu: 'HZB ({renderer}, {depth}) culls objects with an indirect draw.',
    hintHzbCpu: 'HZB ({depth}) returns visibility on the CPU.',
    hintOff: 'Test is off: objects are culled by the frustum only.',
    modeOff: 'off',
    statsBuffer: ' · buffer {width}×{height}',
    statsReading: ' · reading',
    statsObject: ' · object {index}',
    statsLine: '{device} · {mode}{coverage} · {depth} · in frame {visible} / {total}{warming}{debug}',
    joystickMove: 'Move',
    joystickLook: 'Look',
    debugNext: 'Next object',
    debugPrev: 'Previous object',
};

const dictionaries: Record<Lang, { [K in MessageKey]: string }> = { ru, en };

function browserLang(): Lang {
    const tag = navigator.language || navigator.languages?.[0] || '';
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    return primary === 'ru' ? 'ru' : 'en';
}

let lang: Lang = browserLang();

try {
    localStorage.removeItem('optipixel.lang');
} catch {
    // Storage may be unavailable. The language is never read from it.
}
const listeners = new Set<() => void>();

function interpolate(template: string, vars?: Record<string, string | number>): string {
    if (!vars) {
        return template;
    }
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = vars[name];
        return value === undefined ? match : String(value);
    });
}

export function getLang(): Lang {
    return lang;
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
    return interpolate(dictionaries[lang][key], vars);
}

function translateEach(
    root: ParentNode,
    selector: string,
    readKey: (element: HTMLElement) => string | undefined,
    write: (element: HTMLElement, text: string) => void,
): void {
    root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
        const key = readKey(element);
        if (key && key in ru) {
            write(element, t(key as MessageKey));
        }
    });
}

export function applyTranslations(root: ParentNode = document): void {
    translateEach(root, '[data-i18n]', (element) => element.dataset.i18n, (element, text) => {
        element.textContent = text;
    });
    translateEach(root, '[data-i18n-title]', (element) => element.dataset.i18nTitle, (element, text) => {
        element.title = text;
    });
    translateEach(root, '[data-i18n-aria]', (element) => element.dataset.i18nAria, (element, text) => {
        element.setAttribute('aria-label', text);
    });
    document.documentElement.lang = lang;
}

export function setLang(next: Lang): void {
    if (next === lang) {
        return;
    }
    lang = next;
    applyTranslations();
    for (const listener of listeners) {
        listener();
    }
}

export function onLangChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function bindLanguageSelect(select: HTMLSelectElement): void {
    select.value = lang;
    select.addEventListener('change', () => {
        setLang(select.value === 'en' ? 'en' : 'ru');
    });
}

applyTranslations();
