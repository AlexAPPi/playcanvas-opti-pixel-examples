import { AppBase, CameraFrame, Entity, FramePassCameraFrame, SSAOTYPE_NONE } from 'playcanvas';
import { DepthEncoding, DepthSource } from './modes.ts';

/**
 * Selects where the occlusion pyramid reads depth and installs that source
 * on the camera: a depth grab, or a CameraFrame scene-depth map.
 */
export class CameraDepth {

    private _source: DepthSource = DepthSource.DepthGrab;
    private _encoding: DepthEncoding = DepthEncoding.Linear;
    private _useSceneDepthMap = false;
    private _frame: CameraFrame | null = null;
    private _grabRequested = false;

    public constructor(
        private readonly _app: AppBase,
        private readonly _cameraEntity: Entity,
    ) {}

    public get source(): DepthSource {
        return this._source;
    }

    /** Requested CameraFrame encoding. Depth grab ignores it and stays on device Z. */
    public get encoding(): DepthEncoding {
        return this._encoding;
    }

    public get useSceneDepthMap(): boolean {
        return this._useSceneDepthMap;
    }

    public get linearSupported(): boolean {
        return this._app.graphicsDevice.textureFloatRenderable;
    }

    public get reciprocalSupported(): boolean {
        return FramePassCameraFrame.isSceneTextureDepthSupported(this._app.graphicsDevice);
    }

    public setSource(value: DepthSource): void {
        if (value === this._source) {
            return;
        }
        this._source = value;
        this.apply();
    }

    public setEncoding(value: DepthEncoding): void {
        const encoding = this._supportedEncoding(value);
        if (encoding === this._encoding) {
            return;
        }
        this._encoding = encoding;
        if (this._source === DepthSource.CameraFrame) {
            this.apply();
        }
    }

    /** Point the camera at the selected depth source. */
    public apply(): void {
        const useCameraFrame = this._source === DepthSource.CameraFrame;
        this._useSceneDepthMap = useCameraFrame;
        if (useCameraFrame) {
            this._setDepthGrab(false);
            this._ensureCameraFrame();
            this._configureCameraFrame();
            return;
        }

        this._destroyCameraFrame();
        this._setDepthGrab(true);
    }

    public release(): void {
        this._useSceneDepthMap = false;
        this._destroyCameraFrame();
        this._setDepthGrab(false);
    }

    private _supportedEncoding(value: DepthEncoding): DepthEncoding {
        if (value === DepthEncoding.Packed && this.linearSupported) {
            return DepthEncoding.Linear;
        }
        if (value === DepthEncoding.Linear && !this.linearSupported) {
            return DepthEncoding.Packed;
        }
        if (value === DepthEncoding.Reciprocal && !this.reciprocalSupported) {
            return this.linearSupported ? DepthEncoding.Linear : DepthEncoding.Packed;
        }
        return value;
    }

    private _configureCameraFrame(): void {
        const frame = this._frame;
        const component = this._cameraEntity.camera;
        if (!frame || !component) {
            return;
        }

        const encoding = this._supportedEncoding(this._encoding);
        this._encoding = encoding;
        const reciprocal = encoding === DepthEncoding.Reciprocal;
        frame.rendering.sceneDepthMap = !reciprocal;
        frame.rendering.samples = 1;
        frame.taa.enabled = reciprocal;
        frame.taa.jitter = 0;
        frame.dof.enabled = false;
        frame.ssao.type = SSAOTYPE_NONE;
        frame.bloom.intensity = 0;
        frame.volumetricFog.enabled = false;
        frame.update();

        if (encoding === DepthEncoding.Linear) {
            const params = component.shaderParams;
            params.sceneDepthMapLinear = true;
            params.sceneDepthMapPacked = false;
            params.sceneDepthMapReciprocal = false;
        }
    }

    private _setDepthGrab(enabled: boolean): void {
        const camera = this._cameraEntity.camera;
        if (!camera || this._grabRequested === enabled) {
            return;
        }
        camera.requestSceneDepthMap(enabled);
        this._grabRequested = enabled;
    }

    private _ensureCameraFrame(): void {
        const component = this._cameraEntity.camera;
        if (!component) {
            return;
        }
        if (!this._frame) {
            this._frame = new CameraFrame(this._app, component);
        }
    }

    private _destroyCameraFrame(): void {
        this._frame?.destroy();
        this._frame = null;
    }
}
