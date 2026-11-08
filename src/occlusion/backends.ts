import {
    AppBase,
    BoundingBox,
    Camera,
    Color,
    Vec3,
    WebglGraphicsDevice,
    WebgpuGraphicsDevice,
    WireRenderer,
} from 'playcanvas';
import {
    AABBStore,
    CoverageBufferDebugger,
    CoverageBufferTesterWorker,
    HierarchicalZBufferDebugger,
    WebglCoverageBuffer,
    WebglHierarchicalZBuffer,
    WebglHZBCPUFBTester,
    WebglOcclusionQueriesTester,
    WebgpuCoverageBuffer,
    WebgpuHierarchicalZBuffer,
    WebgpuHZBTester,
    OCCLUSION_OCCLUDED,
    type IHierarchicalZBuffer,
} from 'playcanvas-opti-pixel';
import { CoverageEnqueueGate } from '../coverage-enqueue.ts';
import { coveragePreviewQuads } from './coverage-preview.ts';
import { HzbRenderer } from './modes.ts';

/** WebGL pyramid keeps its stored mips at or below this size. */
const WEBGL_HZB_MAX_SIZE = 512;

/**
 * The pyramid adopts the depth-texture size itself. Tester shaders bake the
 * mip count, so rebind them only after that count changes.
 */
function updatePyramid(
    pyramid: IHierarchicalZBuffer,
    camera: Camera,
    useSceneDepth: boolean,
    rebind: () => void,
): void {
    const mipLevels = pyramid.mipLevels;
    if (useSceneDepth) {
        pyramid.updateSceneDepth(camera);
    } else {
        pyramid.update(camera);
    }
    if (pyramid.mipLevels !== mipLevels) {
        rebind();
    }
}

/**
 * WebGL2 hierarchical Z: a pixel pyramid plus a transform-feedback readback.
 * Visibility returns to the CPU a few frames later.
 */
export class Webgl2HzbOcclusion {

    public readonly pyramid: WebglHierarchicalZBuffer;
    public readonly tester: WebglHZBCPUFBTester;

    private readonly _overlay: HierarchicalZBufferDebugger;

    public constructor(app: AppBase, device: WebglGraphicsDevice, store: AABBStore) {
        this.pyramid = new WebglHierarchicalZBuffer(device, WEBGL_HZB_MAX_SIZE);
        this.tester = new WebglHZBCPUFBTester(this.pyramid, store);
        this._overlay = new HierarchicalZBufferDebugger(app, this.tester);
    }

    public setEnabled(value: boolean): void {
        this.pyramid.enabled = value;
    }

    public frameUpdate(dt: number): void {
        this.tester.frameUpdate(dt);
    }

    public set opacity(value: number) {
        this._overlay.opacity = value;
    }

    public drawOverlay(): void {
        this._overlay.debug(this.pyramid.mipLevels);
    }

    public debugMipLevel(level: number): void {
        this._overlay.debugMipLevel(level);
    }

    public debugItem(index: number, box: boolean, rect: boolean, mipLevel: boolean): void {
        this._overlay.debugItem(index, box, rect, mipLevel);
    }

    public updatePyramid(camera: Camera, useSceneDepth: boolean): void {
        updatePyramid(this.pyramid, camera, useSceneDepth, () => {
            this.tester.hzb = this.pyramid;
            this._overlay.hzbOrTester = this.tester;
        });
    }

    public update(camera: Camera, useSceneDepth: boolean): void {
        this.updatePyramid(camera, useSceneDepth);
        this.tester.execute(camera);
    }

    public resize(): void {
        this.tester.resize();
    }

    public destroy(): void {
        this.pyramid.destroy();
        this.tester.destroy();
        this._overlay.destroy();
    }
}

/**
 * WebGL2 occlusion queries. Each box is drawn with a query after the opaque
 * layer, and the pass/fail result is read back on a later frame.
 */
export class Webgl2QueriesOcclusion {

    public readonly tester: WebglOcclusionQueriesTester;

    private readonly _wire: WireRenderer;
    private readonly _box = new BoundingBox();
    private readonly _min = new Vec3();
    private readonly _max = new Vec3();

    public constructor(app: AppBase, store: AABBStore) {
        this.tester = new WebglOcclusionQueriesTester(app, store);
        this._wire = new WireRenderer(app);
        this._wire.depthTest = false;
    }

    public set freeze(value: boolean) {
        this.tester.freeze = value;
    }

    public frameUpdate(dt: number): void {
        this.tester.frameUpdate(dt);
    }

    public execute(camera: Camera): void {
        this.tester.execute(camera);
    }

    public debugItem(index: number, box: boolean): void {
        if (!box) {
            return;
        }
        this.tester.getBoundingBox(index, this._box);
        const status = this.tester.getOcclusionStatus(index);
        this._wire.color.copy(status === OCCLUSION_OCCLUDED ? Color.RED : Color.GREEN);
        this._min.copy(this._box.center).sub(this._box.halfExtents);
        this._max.copy(this._box.center).add(this._box.halfExtents);
        this._wire.boxMinMax(this._min, this._max);
    }

    public resize(): void {
        this.tester.resize();
    }

    public destroy(): void {
        this.tester.destroy();
    }
}

/**
 * WebGPU hierarchical Z. The pyramid is a compute or pixel mip chain, and the
 * tester writes indirect-draw counts so occluded meshes are skipped on the GPU.
 */
export class WebgpuHzbOcclusion {

    public readonly pyramid: WebgpuHierarchicalZBuffer;
    public readonly tester: WebgpuHZBTester;

    private readonly _overlay: HierarchicalZBufferDebugger;

    public constructor(app: AppBase, device: WebgpuGraphicsDevice, store: AABBStore) {
        this.pyramid = new WebgpuHierarchicalZBuffer(device, true);
        this.tester = new WebgpuHZBTester(this.pyramid, store);
        this._overlay = new HierarchicalZBufferDebugger(app, this.tester);
    }

    public get renderer(): HzbRenderer {
        return this.pyramid.useCompute ? HzbRenderer.Compute : HzbRenderer.Pixel;
    }

    public setRenderer(value: HzbRenderer): void {
        const useCompute = value === HzbRenderer.Compute;
        if (this.pyramid.useCompute === useCompute) {
            return;
        }
        this.pyramid.useCompute = useCompute;
    }

    public setEnabled(value: boolean): void {
        this.pyramid.enabled = value;
    }

    public frameUpdate(dt: number): void {
        this.tester.frameUpdate(dt);
    }

    public set opacity(value: number) {
        this._overlay.opacity = value;
    }

    public drawOverlay(): void {
        this._overlay.debug(this.pyramid.mipLevels);
    }

    public debugMipLevel(level: number): void {
        this._overlay.debugMipLevel(level);
    }

    public debugItem(index: number, box: boolean, rect: boolean, mipLevel: boolean): void {
        this._overlay.debugItem(index, box, rect, mipLevel);
    }

    public updatePyramid(camera: Camera, useSceneDepth: boolean): void {
        updatePyramid(this.pyramid, camera, useSceneDepth, () => {
            this.tester.hzb = this.pyramid;
            this._overlay.hzbOrTester = this.tester;
        });
    }

    public resize(): void {
        this.tester.resize();
    }

    public destroy(): void {
        this.pyramid.destroy();
        this.tester.destroy();
        this._overlay.destroy();
    }
}

/**
 * Packs one mip of the active HZB into a view-space Z map, downloads it, and
 * tests AABBs on a worker. The pyramid still has to be built every frame.
 */
export class CoverageOcclusion {

    public readonly buffer: WebglCoverageBuffer | WebgpuCoverageBuffer;
    public readonly gate: CoverageEnqueueGate;

    private readonly _tester: CoverageBufferTesterWorker;
    private readonly _overlay: CoverageBufferDebugger;

    public constructor(app: AppBase, device: WebglGraphicsDevice | WebgpuGraphicsDevice, capacity: number) {
        this.buffer = device.isWebGPU ?
            new WebgpuCoverageBuffer(device as WebgpuGraphicsDevice) :
            new WebglCoverageBuffer(device as WebglGraphicsDevice);
        this._tester = new CoverageBufferTesterWorker(this.buffer, capacity);
        this.gate = new CoverageEnqueueGate(this._tester);
        this._overlay = new CoverageBufferDebugger(app, this._tester);
    }

    public get ready(): boolean {
        return this.buffer.cpuReady;
    }

    public activate(): void {
        this.buffer.enabled = true;
        this.gate.reset();
    }

    public deactivate(camera: Camera | null): void {
        this.buffer.enabled = false;
        if (camera) {
            this.gate.execute(camera);
        } else {
            this.gate.reset();
        }
    }

    public frameUpdate(dt: number): void {
        this._tester.frameUpdate(dt);
    }

    public execute(camera: Camera): void {
        this.gate.execute(camera);
    }

    public capture(pyramid: IHierarchicalZBuffer, camera: Camera): void {
        this._tester.updateGPUDepthBuffer(pyramid, camera);
    }

    public resize(capacity: number): void {
        this._tester.resize(capacity);
        this.gate.reset();
    }

    public set opacity(value: number) {
        this._overlay.opacity = value;
    }

    public drawOverlay(): void {
        const [packed, reprojected] = coveragePreviewQuads;
        this._overlay.drawDepth(packed.centerX, packed.centerY, packed.width, packed.height);
        this._overlay.drawReprojectedDepth(reprojected.centerX, reprojected.centerY, reprojected.width, reprojected.height);
    }

    public drawFullscreen(downloaded = false): void {
        if (downloaded) {
            this._overlay.drawDepth(0, 0, 2, 2);
            return;
        }
        this._overlay.drawReprojectedDepth(0, 0, 2, 2);
    }

    public debugItem(index: number, box: boolean, rect: boolean): void {
        this._overlay.debugItem(index, box, rect);
    }

    public destroy(): void {
        this._overlay.destroy();
        this._tester.destroy();
        this.buffer.destroy();
    }
}

export interface OcclusionBackends {
    webgl2Hzb: Webgl2HzbOcclusion | null;
    webgl2Queries: Webgl2QueriesOcclusion | null;
    webgpuHzb: WebgpuHzbOcclusion | null;
    coverage: CoverageOcclusion | null;
}

export function createOcclusionBackends(app: AppBase, store: AABBStore, capacity: number): OcclusionBackends {
    const device = app.graphicsDevice;
    if (device.isWebGL2) {
        const gl = device as WebglGraphicsDevice;
        return {
            webgl2Hzb: new Webgl2HzbOcclusion(app, gl, store),
            webgl2Queries: new Webgl2QueriesOcclusion(app, store),
            webgpuHzb: null,
            coverage: new CoverageOcclusion(app, gl, capacity),
        };
    }
    if (device.isWebGPU) {
        const gpu = device as WebgpuGraphicsDevice;
        return {
            webgl2Hzb: null,
            webgl2Queries: null,
            webgpuHzb: new WebgpuHzbOcclusion(app, gpu, store),
            coverage: new CoverageOcclusion(app, gpu, capacity),
        };
    }
    return {
        webgl2Hzb: null,
        webgl2Queries: null,
        webgpuHzb: null,
        coverage: null,
    };
}
