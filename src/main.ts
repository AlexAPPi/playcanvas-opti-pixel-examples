import {
    AppBase,
    AppOptions,
    CameraComponentSystem,
    Color,
    createGraphicsDevice,
    DEVICETYPE_WEBGL2,
    DEVICETYPE_WEBGPU,
    Entity,
    FILLMODE_FILL_WINDOW,
    GraphicsDevice,
    Keyboard,
    LightComponentSystem,
    MiniStats,
    Mouse,
    RenderComponentSystem,
    RESOLUTION_AUTO,
    StandardMaterial,
    TouchDevice,
} from 'playcanvas';
import { bindControlPanel } from './control-panel.ts';
import { requireElement } from './dom.ts';
import { FlyCamera } from './fly-camera.ts';
import { bindLanguageSelect, onLangChange, t } from './i18n.ts';
import { TesterMode } from './occlusion/modes.ts';
import { OcclusionScene } from './occlusion/scene.ts';

// A hot reload replaces this module while the previous engine is still running.
const page = globalThis as { __optiPixelApp?: AppBase; __optiPixelSelectGuard?: boolean };
if (!page.__optiPixelSelectGuard) {
    page.__optiPixelSelectGuard = true;
    const coarsePointer = window.matchMedia('(pointer: coarse), (hover: none)');
    document.addEventListener('selectstart', (event) => {
        if (coarsePointer.matches) {
            event.preventDefault();
        }
    });
}
const previousApp = (globalThis as { __optiPixelApp?: AppBase }).__optiPixelApp;
previousApp?.destroy();

const nodes = {
    canvas: requireElement<HTMLCanvasElement>('#application'),
    stats: requireElement<HTMLElement>('#stats'),
    error: requireElement<HTMLElement>('#error'),
};
// Filled once the scene is live. Missing markup should fail before the device starts.
requireElement('#hint');

const languageSelect = document.querySelector<HTMLSelectElement>('#language');
if (languageSelect) {
    bindLanguageSelect(languageSelect);
}

let bootStatus: 'starting' | 'failed' | 'live' = 'starting';

function syncBootStatus(): void {
    if (bootStatus === 'starting') {
        nodes.stats.textContent = t('starting');
    } else if (bootStatus === 'failed') {
        nodes.stats.textContent = t('bootFailed');
    }
}

syncBootStatus();
onLangChange(syncBootStatus);
void boot();

async function boot(): Promise<void> {
    try {
        const device = await createDevice(nodes.canvas);
        const app = createApp(nodes.canvas, device);
        addLight(app);
        const groundMaterial = addGround(app);
        const camera = addCamera(app);
        const scene = new OcclusionScene(app, camera, {
            capacity: 30,
            radius: 48,
            tester: TesterMode.Coverage,
        });
        const flyCamera = new FlyCamera(app, camera, {
            onDebugStep: (delta) => {
                scene.stepDebugItem(delta);
            },
        });

        app.start();
        const miniStats = new MiniStats(app);
        bootStatus = 'live';
        bindControlPanel(app, scene, device);
        app.on('destroy', () => {
            miniStats.destroy();
            flyCamera.destroy();
            scene.destroy();
            groundMaterial.destroy();
        });
    } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        bootStatus = 'failed';
        nodes.error.textContent = message;
        nodes.stats.textContent = t('bootFailed');
        console.error(error);
    }
}

async function createDevice(canvas: HTMLCanvasElement): Promise<GraphicsDevice> {
    const kind = new URLSearchParams(location.search).get('device');
    const device = await createGraphicsDevice(canvas, {
        deviceTypes: kind === 'webgl2' ? [DEVICETYPE_WEBGL2] : [DEVICETYPE_WEBGPU],
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
    });
    device.maxIndirectDrawCount = 2048;
    return device;
}

function createApp(canvas: HTMLCanvasElement, device: GraphicsDevice): AppBase {
    const options = new AppOptions();
    options.graphicsDevice = device;
    options.mouse = new Mouse(canvas);
    options.keyboard = new Keyboard(window);
    options.touch = new TouchDevice(canvas);
    options.componentSystems = [
        RenderComponentSystem,
        CameraComponentSystem,
        LightComponentSystem,
    ];
    options.resourceHandlers = [];

    const app = new AppBase(canvas);
    (globalThis as { __optiPixelApp?: AppBase }).__optiPixelApp = app;
    app.init(options);
    app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(RESOLUTION_AUTO);
    window.addEventListener('resize', () => app.resizeCanvas());
    app.scene.ambientLight = new Color(0.32, 0.35, 0.4);
    return app;
}

function addLight(app: AppBase): void {
    const light = new Entity('light');
    light.addComponent('light', {
        type: 'directional',
        color: new Color(1, 0.96, 0.9),
        intensity: 1.4,
        castShadows: false,
    });
    light.setEulerAngles(52, 30, 0);
    app.root.addChild(light);
}

function addGround(app: AppBase): StandardMaterial {
    const material = new StandardMaterial();
    material.diffuse = new Color(0.42, 0.46, 0.4);
    material.gloss = 0.1;
    material.metalness = 0;
    material.useMetalness = true;
    material.update();

    const ground = new Entity('ground');
    ground.addComponent('render', {
        type: 'box',
        material,
        castShadows: false,
    });
    ground.setLocalScale(400, 1, 400);
    ground.setPosition(0, -0.5, 0);
    app.root.addChild(ground);
    return material;
}

function addCamera(app: AppBase): Entity {
    const camera = new Entity('camera');
    camera.addComponent('camera', {
        clearColor: new Color(0.62, 0.72, 0.82),
        fov: 60,
        nearClip: 0.05,
        farClip: 1000,
    });
    camera.setPosition(0, 8, 36);
    camera.lookAt(0, 4, 0);
    app.root.addChild(camera);
    return camera;
}
