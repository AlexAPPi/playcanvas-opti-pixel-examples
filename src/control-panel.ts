import { AppBase, GraphicsDevice } from 'playcanvas';
import { requireElement } from './dom.ts';
import { onLangChange, t } from './i18n.ts';
import { OcclusionScene } from './occlusion/scene.ts';
import { DepthEncoding, DepthSource, HzbRenderer, TesterMode } from './occlusion/modes.ts';

interface PanelElements {
    device: HTMLSelectElement;
    tester: HTMLSelectElement;
    hzbRenderer: HTMLSelectElement;
    depthSource: HTMLSelectElement;
    depthEncoding: HTMLSelectElement;
    capacity: HTMLInputElement;
    radius: HTMLInputElement;
    objectScale: HTMLInputElement;
    capacityValue: HTMLElement;
    radiusValue: HTMLElement;
    objectScaleValue: HTMLElement;
    coverageWidthRow: HTMLElement;
    coverageHeightRow: HTMLElement;
    coverageWidth: HTMLSelectElement;
    coverageHeight: HTMLSelectElement;
    readbackLagRow: HTMLElement;
    readbackSlotsRow: HTMLElement;
    readbackPeriodRow: HTMLElement;
    cpuReadbackRow: HTMLElement;
    readbackLag: HTMLSelectElement;
    readbackSlots: HTMLSelectElement;
    readbackPeriod: HTMLSelectElement;
    cpuReadback: HTMLInputElement;
    autoUpdate: HTMLInputElement;
    drawHzb: HTMLInputElement;
    debug: HTMLInputElement;
    debugMip: HTMLInputElement;
    coverageMapRow: HTMLElement;
    coverageMap: HTMLSelectElement;
    mipLevel: HTMLInputElement;
    mipValue: HTMLElement;
    mipOpacity: HTMLInputElement;
    mipOpacityValue: HTMLElement;
    stats: HTMLElement;
    hint: HTMLElement;
}

export function bindControlPanel(app: AppBase, scene: OcclusionScene, device: GraphicsDevice): void {
    new ControlPanel(app, scene, device).bind();
}

class ControlPanel {

    private readonly _ui = readPanelElements();
    private readonly _deviceName: string;
    private readonly _coarseQuery = window.matchMedia('(pointer: coarse), (hover: none)');
    private _unsubscribeLang: (() => void) | null = null;

    public constructor(
        private readonly _app: AppBase,
        private readonly _scene: OcclusionScene,
        private readonly _device: GraphicsDevice,
    ) {
        this._deviceName = deviceLabel(_device);
    }

    public bind(): void {
        this._syncInitialState();
        this._refreshLocalized();
        this._listenForLocaleChanges();
        this._bindControls();
        this._app.on('update', this._onFrame);
    }

    private _syncInitialState(): void {
        this._syncDeviceSelect();
        this._syncTesterOptions();
        this._syncHzbRenderer();
        this._syncDepthControls();
        this._syncScalar('capacity');
        this._syncScalar('radius');
        this._syncScalar('scale');
        this._syncCoverageCap();
        this._syncCoverageReadback();
    }

    private _syncDeviceSelect(): void {
        const requested = new URLSearchParams(location.search).get('device') ?? 'auto';
        this._ui.device.value = requested === 'webgpu' || requested === 'webgl2' ? requested : 'auto';
    }

    private _syncTesterOptions(): void {
        const scene = this._scene;
        this._setOptionDisabled(this._ui.tester, '3', !scene.queriesAvailable);
        this._setOptionDisabled(this._ui.tester, '2', !scene.hzbAvailable);
        this._setOptionDisabled(this._ui.tester, '1', !scene.coverageAvailable);
        this._ui.tester.value = String(scene.tester);
    }

    private _syncHzbRenderer(): void {
        this._syncHzbRendererTitle();
        const renderer = this._scene.hzbRenderer;
        if (renderer) {
            this._ui.hzbRenderer.value = renderer;
        }
    }

    private _syncHzbRendererTitle = (): void => {
        const renderer = this._scene.hzbRenderer;
        this._ui.hzbRenderer.disabled = renderer === null;
        this._ui.hzbRenderer.title = renderer === null ? t('hzbRendererUnavailable') : t('hzbRendererTitle');
    };

    private _syncDepthControls(): void {
        const scene = this._scene;
        this._ui.depthSource.value = scene.depthSource;
        this._setOptionDisabled(this._ui.depthEncoding, DepthEncoding.Linear, !scene.linearDepthSupported);
        this._setOptionDisabled(this._ui.depthEncoding, DepthEncoding.Packed, scene.linearDepthSupported);
        this._setOptionDisabled(this._ui.depthEncoding, DepthEncoding.Reciprocal, !scene.reciprocalDepthSupported);
        this._ui.depthEncoding.value = scene.depthEncoding;
        this._syncDepthEncoding();
    }

    private _syncDepthEncoding = (): void => {
        const cameraFrame = this._scene.depthSource === DepthSource.CameraFrame;
        this._ui.depthEncoding.disabled = !cameraFrame;
        this._ui.depthEncoding.value = this._scene.depthEncoding;
        this._ui.depthEncoding.title = cameraFrame ? t('encodingCameraFrame') : t('encodingDepthGrab');
    };

    private _syncScalar(kind: 'capacity' | 'radius' | 'scale'): void {
        const raw = kind === 'capacity' ? this._scene.capacity :
            kind === 'radius' ? this._scene.radius :
                this._scene.objectScale;
        const value = kind === 'scale' ? raw.toFixed(2) : String(raw);
        const input = kind === 'capacity' ? this._ui.capacity :
            kind === 'radius' ? this._ui.radius :
                this._ui.objectScale;
        const label = kind === 'capacity' ? this._ui.capacityValue :
            kind === 'radius' ? this._ui.radiusValue :
                this._ui.objectScaleValue;
        input.value = value;
        label.textContent = value;
    }

    private _syncCoverageCap(): void {
        const cap = this._scene.coverageBufferCap;
        if (!cap) {
            return;
        }
        this._ui.coverageWidth.value = String(cap.width);
        this._ui.coverageHeight.value = String(cap.height);
    }

    private _syncCoverageReadback(): void {
        const scene = this._scene;
        const ui = this._ui;
        ui.readbackLag.value = String(scene.coverageMinReadbackLag);
        ui.readbackSlots.value = String(scene.coverageReadbackSlots);
        ui.readbackPeriod.value = String(scene.coverageReadbackPeriod);
        ui.cpuReadback.checked = scene.coverageCpuReadback;
    }

    private _listenForLocaleChanges(): void {
        this._coarseQuery.addEventListener('change', this._refreshHint);
        this._unsubscribeLang = onLangChange(this._refreshLocalized);
        this._app.on('destroy', () => {
            this._unsubscribeLang?.();
            this._coarseQuery.removeEventListener('change', this._refreshHint);
        });
    }

    private _bindControls(): void {
        const ui = this._ui;
        const scene = this._scene;

        ui.device.addEventListener('change', () => {
            const url = new URL(location.href);
            if (ui.device.value === 'auto') {
                url.searchParams.delete('device');
            } else {
                url.searchParams.set('device', ui.device.value);
            }
            location.href = url.toString();
        });

        ui.tester.addEventListener('change', () => {
            scene.setTester(Number(ui.tester.value) as TesterMode);
            ui.tester.value = String(scene.tester);
            this._refreshHint();
        });

        ui.hzbRenderer.addEventListener('change', () => {
            scene.setHzbRenderer(ui.hzbRenderer.value as HzbRenderer);
            const renderer = scene.hzbRenderer;
            if (renderer) {
                ui.hzbRenderer.value = renderer;
            }
            this._refreshHint();
        });

        ui.depthSource.addEventListener('change', () => {
            const value = ui.depthSource.value === DepthSource.CameraFrame ?
                DepthSource.CameraFrame :
                DepthSource.DepthGrab;
            scene.setDepthSource(value);
            ui.depthSource.value = scene.depthSource;
            this._syncDepthEncoding();
            this._refreshHint();
        });

        ui.depthEncoding.addEventListener('change', () => {
            scene.setDepthEncoding(ui.depthEncoding.value as DepthEncoding);
            ui.depthEncoding.value = scene.depthEncoding;
            this._refreshHint();
        });

        ui.capacity.addEventListener('input', () => {
            ui.capacityValue.textContent = ui.capacity.value;
        });
        ui.capacity.addEventListener('change', () => {
            scene.setCapacity(Number(ui.capacity.value));
        });

        ui.radius.addEventListener('input', () => {
            ui.radiusValue.textContent = ui.radius.value;
            scene.setRadius(Number(ui.radius.value));
        });

        ui.objectScale.addEventListener('input', () => {
            ui.objectScaleValue.textContent = Number(ui.objectScale.value).toFixed(2);
            scene.setObjectScale(Number(ui.objectScale.value));
        });

        const applyCoverageSize = (): void => {
            scene.setCoverageBufferSize(Number(ui.coverageWidth.value), Number(ui.coverageHeight.value));
        };
        ui.coverageWidth.addEventListener('change', applyCoverageSize);
        ui.coverageHeight.addEventListener('change', applyCoverageSize);

        ui.readbackSlots.addEventListener('change', () => {
            scene.setCoverageReadbackSlots(Number(ui.readbackSlots.value));
            ui.readbackSlots.value = String(scene.coverageReadbackSlots);
        });
        ui.readbackLag.addEventListener('change', () => {
            scene.setCoverageMinReadbackLag(Number(ui.readbackLag.value));
            ui.readbackLag.value = String(scene.coverageMinReadbackLag);
        });
        ui.readbackPeriod.addEventListener('change', () => {
            scene.setCoverageReadbackPeriod(Number(ui.readbackPeriod.value));
            ui.readbackPeriod.value = String(scene.coverageReadbackPeriod);
        });
        ui.cpuReadback.addEventListener('change', () => {
            scene.setCoverageCpuReadback(ui.cpuReadback.checked);
        });

        ui.autoUpdate.addEventListener('change', () => {
            scene.setAutoUpdate(ui.autoUpdate.checked);
        });

        ui.drawHzb.checked = true;
        scene.setDrawHZB(true);
        ui.drawHzb.addEventListener('change', () => {
            scene.setDrawHZB(ui.drawHzb.checked);
        });

        ui.debug.addEventListener('change', () => {
            scene.setDebug(ui.debug.checked);
        });
        ui.debugMip.addEventListener('change', () => {
            scene.setDebugMipLevel(ui.debugMip.checked);
        });
        ui.coverageMap.addEventListener('change', () => {
            this._syncCoverageControls();
        });

        ui.mipLevel.addEventListener('input', () => {
            ui.mipValue.textContent = ui.mipLevel.value;
            scene.setMipLevel(Number(ui.mipLevel.value));
        });

        this._syncMipOpacity();
        ui.mipOpacity.addEventListener('input', this._syncMipOpacity);
    }

    private _syncMipOpacity = (): void => {
        const opacity = Number(this._ui.mipOpacity.value);
        this._ui.mipOpacityValue.textContent = opacity.toFixed(2);
        this._scene.setDebugMipOpacity(opacity);
    };

    private _refreshLocalized = (): void => {
        this._syncHzbRendererTitle();
        this._syncDepthEncoding();
        this._refreshHint();
    };

    private _refreshHint = (): void => {
        const scene = this._scene;
        const renderer = scene.hzbRenderer === HzbRenderer.Pixel ? 'pixel' : 'compute';
        const depth = depthModeLabel(scene);
        const pyramid = this._device.isWebGPU ? t('pyramidRenderer', { renderer }) : t('pyramidHzb');
        const controls = this._coarseQuery.matches ? t('controlsTouch') : t('controlsMouse');
        this._ui.hint.textContent = `${this._deviceName}: ${hintForTester(scene, this._device, renderer, depth, pyramid)} ${controls}`;
        this._syncCoverageControls();
    };

    private _syncCoverageControls(): void {
        const ui = this._ui;
        const coverage = this._scene.tester === TesterMode.Coverage;
        const downloaded = ui.coverageMap.value === 'downloaded';
        ui.mipLevel.disabled = coverage;
        ui.coverageMapRow.hidden = !coverage;
        ui.coverageMap.disabled = !coverage;
        ui.coverageWidthRow.hidden = !coverage;
        ui.coverageHeightRow.hidden = !coverage;
        ui.coverageWidth.disabled = !coverage;
        ui.coverageHeight.disabled = !coverage;
        ui.readbackLagRow.hidden = !coverage;
        ui.readbackSlotsRow.hidden = !coverage;
        ui.readbackPeriodRow.hidden = !coverage;
        ui.cpuReadbackRow.hidden = !coverage;
        ui.readbackLag.disabled = !coverage;
        ui.readbackSlots.disabled = !coverage;
        ui.readbackPeriod.disabled = !coverage;
        ui.cpuReadback.disabled = !coverage;
        this._scene.setCoverageFullscreenDownloaded(coverage && downloaded);
        ui.debugMip.title = coverage ?
            (downloaded ? t('debugMipDownloaded') : t('debugMipReprojected')) :
            t('debugMipHzb');
    }

    private _onFrame = (): void => {
        const debugOn = this._scene.debugEnabled;
        if (this._ui.debug.checked !== debugOn) {
            this._ui.debug.checked = debugOn;
        }

        this._ui.stats.textContent = statsLine(this._scene, this._deviceName);
    };

    private _setOptionDisabled(select: HTMLSelectElement, value: string, disabled: boolean): void {
        const option = select.querySelector<HTMLOptionElement>(`option[value="${value}"]`);
        if (option) {
            option.disabled = disabled;
        }
    }
}

function readPanelElements(): PanelElements {
    return {
        device: requireElement('#device'),
        tester: requireElement('#tester'),
        hzbRenderer: requireElement('#hzb-renderer'),
        depthSource: requireElement('#depth-source'),
        depthEncoding: requireElement('#depth-encoding'),
        capacity: requireElement('#capacity'),
        radius: requireElement('#radius'),
        objectScale: requireElement('#object-scale'),
        capacityValue: requireElement('#capacity-value'),
        radiusValue: requireElement('#radius-value'),
        objectScaleValue: requireElement('#object-scale-value'),
        coverageWidthRow: requireElement('#coverage-width-row'),
        coverageHeightRow: requireElement('#coverage-height-row'),
        coverageWidth: requireElement('#coverage-width'),
        coverageHeight: requireElement('#coverage-height'),
        readbackLagRow: requireElement('#readback-lag-row'),
        readbackSlotsRow: requireElement('#readback-slots-row'),
        readbackPeriodRow: requireElement('#readback-period-row'),
        cpuReadbackRow: requireElement('#cpu-readback-row'),
        readbackLag: requireElement('#readback-lag'),
        readbackSlots: requireElement('#readback-slots'),
        readbackPeriod: requireElement('#readback-period'),
        cpuReadback: requireElement('#cpu-readback'),
        autoUpdate: requireElement('#auto-update'),
        drawHzb: requireElement('#draw-hzb'),
        debug: requireElement('#debug'),
        debugMip: requireElement('#debug-mip'),
        coverageMapRow: requireElement('#coverage-map-row'),
        coverageMap: requireElement('#coverage-map'),
        mipLevel: requireElement('#mip-level'),
        mipValue: requireElement('#mip-value'),
        mipOpacity: requireElement('#mip-opacity'),
        mipOpacityValue: requireElement('#mip-opacity-value'),
        stats: requireElement('#stats'),
        hint: requireElement('#hint'),
    };
}

function deviceLabel(device: GraphicsDevice): string {
    if (device.isWebGPU) {
        return 'WebGPU';
    }
    if (device.isWebGL2) {
        return 'WebGL2';
    }
    return device.deviceType;
}

function depthModeLabel(scene: OcclusionScene): string {
    if (scene.depthSource !== DepthSource.CameraFrame) {
        return 'depth grab';
    }
    if (scene.depthEncoding === DepthEncoding.Packed) {
        return 'packed';
    }
    if (scene.depthEncoding === DepthEncoding.Reciprocal) {
        return 'reciprocal';
    }
    return 'linear';
}

function hintForTester(
    scene: OcclusionScene,
    device: GraphicsDevice,
    renderer: string,
    depth: string,
    pyramid: string,
): string {
    if (scene.tester === TesterMode.Coverage) {
        return t('hintCoverage', { pyramid, depth });
    }
    if (scene.tester === TesterMode.Queries) {
        return t('hintQueries');
    }
    if (scene.tester === TesterMode.HZB) {
        return device.isWebGPU ?
            t('hintHzbGpu', { renderer, depth }) :
            t('hintHzbCpu', { depth });
    }
    return t('hintOff');
}

function testerName(tester: TesterMode): string {
    if (tester === TesterMode.Coverage) {
        return 'Coverage';
    }
    if (tester === TesterMode.Queries) {
        return 'Queries';
    }
    if (tester === TesterMode.HZB) {
        return 'HZB';
    }
    return t('modeOff');
}

function statsLine(scene: OcclusionScene, deviceName: string): string {
    const debugItem = scene.debugItemIndex;
    const coverageSize = scene.coverageBufferSize;
    return t('statsLine', {
        device: deviceName,
        mode: testerName(scene.tester),
        coverage: scene.tester === TesterMode.Coverage && coverageSize ?
            t('statsBuffer', { width: coverageSize.width, height: coverageSize.height }) :
            '',
        depth: depthModeLabel(scene),
        visible: scene.visibleCount,
        total: scene.totalCount,
        warming: scene.tester === TesterMode.Coverage && !scene.coverageReady ? t('statsReading') : '',
        debug: debugItem >= 0 ? t('statsObject', { index: debugItem }) : '',
    });
}
