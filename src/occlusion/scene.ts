import {
    AppBase,
    Camera,
    CameraComponent,
    Color,
    Entity,
    EVENT_POSTRENDER_LAYER,
    EVENT_PRECULL,
    EventHandle,
    KEY_ADD,
    KEY_B,
    KEY_C,
    KEY_EQUAL,
    KEY_R,
    KEY_SUBTRACT,
    Layer,
    StandardMaterial,
    Vec3,
} from 'playcanvas';
import { AABBStore, FRUSTUM_OUTSIDE, type IOcclusionCullingTester } from 'playcanvas-opti-pixel';
import { CullingObject } from '../culling-object.ts';
import {
    CoverageBufferOptions,
    CoverageOcclusion,
    Webgl2HzbOcclusion,
    Webgl2QueriesOcclusion,
    WebgpuHzbOcclusion,
    createOcclusionBackends,
    type CoverageDebugStats,
} from './backends.ts';
import { CameraDepth } from './camera-depth.ts';
import {
    ObjectPlacement,
    layoutWall,
    scaleScatterAboutCenter,
    scatterShape,
    separateOverlaps,
    wallCount,
    type ShapeName,
} from './layout.ts';
import { DepthEncoding, DepthSource, HzbRenderer, TesterMode } from './modes.ts';

/** Occlusion queries run after the opaque pass of this layer. */
const QUERIES_LAYER_NAME = 'World';

const WALL_COLOR = new Color(0.62, 0.58, 0.52);
const OBJECT_COLORS = [
    new Color(0.86, 0.42, 0.32),
    new Color(0.35, 0.62, 0.78),
    new Color(0.45, 0.68, 0.42),
    new Color(0.78, 0.66, 0.32),
    new Color(0.55, 0.48, 0.72),
];

export interface OcclusionSceneOptions {
    capacity?: number;
    radius?: number;
    tester?: TesterMode;
    coverage?: CoverageBufferOptions;
}

export class OcclusionScene {

    public readonly root: Entity;

    private readonly _app: AppBase;
    private readonly _cameraEntity: Entity;
    private readonly _depth: CameraDepth;
    private readonly _aabbStore: AABBStore;
    private readonly _webgl2Hzb: Webgl2HzbOcclusion | null;
    private readonly _webgl2Queries: Webgl2QueriesOcclusion | null;
    private readonly _webgpuHzb: WebgpuHzbOcclusion | null;
    private readonly _coverage: CoverageOcclusion | null;
    private readonly _materials: StandardMaterial[] = [];
    private readonly _wallMaterial: StandardMaterial;
    private readonly _positions: Vec3[] = [];
    private readonly _scales: Vec3[] = [];
    private readonly _shapes: ShapeName[] = [];
    private readonly _objects: CullingObject[] = [];

    private _capacity: number;
    private _radius: number;
    private _objectScale = 1;
    private _tester: TesterMode;
    private _autoUpdate = true;
    private _drawHZB = true;
    private _debug = false;
    private _debugMipLevel = false;
    private _mipLevel = 0;
    private _coverageFullscreenDownloaded = false;
    private _debugItemIdx = -1;
    private _debugBox = true;
    private _debugRect = true;
    private _precullHandle: EventHandle | null = null;
    private _updateHandle: EventHandle | null = null;
    private _postRenderLayerHandle: EventHandle | null = null;
    private _frameUpdateHandle: EventHandle | null = null;
    private _frameEndHandle: EventHandle | null = null;

    public constructor(app: AppBase, cameraEntity: Entity, options: OcclusionSceneOptions = {}) {
        this._app = app;
        this._cameraEntity = cameraEntity;
        this._depth = new CameraDepth(app, cameraEntity);
        this._capacity = options.capacity ?? 100;
        this._radius = options.radius ?? 48;
        this._tester = options.tester ?? TesterMode.Coverage;

        this._aabbStore = new AABBStore(app.graphicsDevice, this._capacity);
        const backends = createOcclusionBackends(app, this._aabbStore, this._capacity, options.coverage);
        this._webgl2Hzb = backends.webgl2Hzb;
        this._webgl2Queries = backends.webgl2Queries;
        this._webgpuHzb = backends.webgpuHzb;
        this._coverage = backends.coverage;

        this._frameUpdateHandle = app.on('frameupdate', this._onFrameUpdate, this);
        this._frameEndHandle = app.on('frameend', this._onFrameEnd, this);
        this._postRenderLayerHandle = app.scene.on(EVENT_POSTRENDER_LAYER, this._onPostRenderLayer, this);
        this._depth.apply();

        this._wallMaterial = this._createMaterial(WALL_COLOR);
        for (const color of OBJECT_COLORS) {
            this._materials.push(this._createMaterial(color));
        }

        this.root = new Entity('occludees');
        app.root.addChild(this.root);
        this._precullHandle = app.scene.on(EVENT_PRECULL, this._onPrecull, this);
        this._updateHandle = app.on('update', this._onUpdate, this);

        this._applyTester();
        this._fillNewSlots(0);
        this._spawnNewObjects(0);
    }

    public get capacity(): number {
        return this._capacity;
    }

    public get radius(): number {
        return this._radius;
    }

    /** Multiplier for cubes, spheres, and cylinders. The wall is unchanged. */
    public get objectScale(): number {
        return this._objectScale;
    }

    public get tester(): TesterMode {
        return this._tester;
    }

    public get depthSource(): DepthSource {
        return this._depth.source;
    }

    /** Requested CameraFrame encoding. Depth grab ignores it and stays on device Z. */
    public get depthEncoding(): DepthEncoding {
        return this._depth.encoding;
    }

    public get linearDepthSupported(): boolean {
        return this._depth.linearSupported;
    }

    public get reciprocalDepthSupported(): boolean {
        return this._depth.reciprocalSupported;
    }

    public get hzbAvailable(): boolean {
        return this._webgl2Hzb !== null || this._webgpuHzb !== null;
    }

    public get queriesAvailable(): boolean {
        return this._webgl2Queries !== null;
    }

    public get coverageAvailable(): boolean {
        return this._coverage !== null;
    }

    /** True after the first packed coverage map has been downloaded. */
    public get coverageReady(): boolean {
        return this._coverage?.ready ?? false;
    }

    /**
     * Coverage GPU-read and worker timings while that test is selected.
     * Other modes report nothing so a stale sample is not shown as live.
     */
    public get coverageDebugStats(): CoverageDebugStats | null {
        if (this._tester !== TesterMode.Coverage) {
            return null;
        }
        return this._coverage?.debugStats ?? null;
    }

    /**
     * Place the GPU harvest after MiniStats has opened its CPU window.
     * Call once, after `new MiniStats`. The download then counts toward CPU
     * and still finishes before precull runs `execute`.
     */
    public bindHarvestAfterCpuTimer(): void {
        this._frameUpdateHandle?.off();
        this._frameUpdateHandle = this._app.on('frameupdate', this._onFrameUpdate, this);
    }

    /**
     * Packed coverage map size in texels.
     * Until the first download this is the allocation cap.
     */
    public get coverageBufferSize(): { width: number; height: number } | null {
        const buffer = this._coverage?.buffer;
        if (!buffer) {
            return null;
        }
        return { width: buffer.cpuWidth, height: buffer.cpuHeight };
    }

    /** Allocation cap of the packed coverage map, in texels. */
    public get coverageBufferCap(): { width: number; height: number } | null {
        const buffer = this._coverage?.buffer;
        if (!buffer) {
            return null;
        }
        return { width: buffer.width, height: buffer.height };
    }

    /** Set the packed coverage map cap. The harvested footprint stays within it. */
    public setCoverageBufferSize(width: number, height: number): void {
        const buffer = this._coverage?.buffer;
        if (!buffer) {
            return;
        }
        const nextWidth = Math.max(1, Math.floor(width));
        const nextHeight = Math.max(1, Math.floor(height));
        if (nextWidth === buffer.width && nextHeight === buffer.height) {
            return;
        }
        buffer.resize(nextWidth, nextHeight);
    }

    /** Frames `frameUpdate` waits before copying a finished download. Default 2. */
    public get coverageMinReadbackLag(): number {
        return this._coverage?.buffer.minReadbackLag ?? 2;
    }

    public setCoverageMinReadbackLag(value: number): void {
        const buffer = this._coverage?.buffer;
        if (buffer) {
            buffer.minReadbackLag = value;
        }
    }

    /** In-flight downloads. Minimum 2, default 5. A change drops downloads still in flight. */
    public get coverageReadbackSlots(): number {
        return this._coverage?.buffer.readbackSlots ?? 5;
    }

    public setCoverageReadbackSlots(value: number): void {
        const buffer = this._coverage?.buffer;
        if (buffer) {
            buffer.readbackSlots = value;
        }
    }

    /** Pack every Nth attempt while a slot is free. Harvest still runs every frame. Default 1. */
    public get coverageReadbackPeriod(): number {
        return this._coverage?.buffer.readbackPeriod ?? 1;
    }

    public setCoverageReadbackPeriod(value: number): void {
        const buffer = this._coverage?.buffer;
        if (buffer) {
            buffer.readbackPeriod = value;
        }
    }

    /** When false, capture does not pack or start a readback. */
    public get coverageCpuReadback(): boolean {
        return this._coverage?.buffer.cpuReadback ?? true;
    }

    public setCoverageCpuReadback(value: boolean): void {
        const buffer = this._coverage?.buffer;
        if (buffer) {
            buffer.cpuReadback = value;
        }
    }

    /** WebGPU pyramid can switch between a compute dispatch and a pixel pass. */
    public get hzbRenderer(): HzbRenderer | null {
        return this._webgpuHzb?.renderer ?? null;
    }

    public get visibleCount(): number {
        let count = 0;
        for (const object of this._objects) {
            if (object.drawn) {
                count++;
            }
        }
        return count;
    }

    public get totalCount(): number {
        return this._objects.length;
    }

    public get debugItemIndex(): number {
        return this._debug && this._debugItemIdx >= 0 ? this._debugItemIdx : -1;
    }

    public setAutoUpdate(value: boolean): void {
        this._autoUpdate = value;
        if (this._webgl2Queries) {
            this._webgl2Queries.freeze = !value;
        }
    }

    public setDrawHZB(value: boolean): void {
        this._drawHZB = value;
    }

    public get debugEnabled(): boolean {
        return this._debug;
    }

    public setDebug(value: boolean): void {
        this._debug = value;
        if (value && this._debugItemIdx < 0) {
            this._debugItemIdx = 0;
        }
    }

    /** Enables object debug and selects the neighboring object. */
    public stepDebugItem(delta: number): boolean {
        const count = this._objects.length;
        if (count === 0 || delta === 0) {
            return false;
        }

        const sign = delta > 0 ? 1 : -1;
        this._debug = true;
        if (this._debugItemIdx < 0) {
            this._debugItemIdx = sign > 0 ? 0 : count - 1;
            return true;
        }

        this._debugItemIdx = wrapIndex(this._debugItemIdx + sign, count);
        return true;
    }

    public setDebugMipLevel(value: boolean): void {
        this._debugMipLevel = value;
    }

    /** Overlay opacity for mip and coverage debug draws, in [0, 1]. */
    public setDebugMipOpacity(value: number): void {
        const opacity = Math.min(1, Math.max(0, value));
        if (this._webgl2Hzb) {
            this._webgl2Hzb.opacity = opacity;
        }
        if (this._webgpuHzb) {
            this._webgpuHzb.opacity = opacity;
        }
        if (this._coverage) {
            this._coverage.opacity = opacity;
        }
    }

    /** Fullscreen Coverage map: the downloaded capture, or the reprojected one. */
    public setCoverageFullscreenDownloaded(value: boolean): void {
        this._coverageFullscreenDownloaded = value;
    }

    public setMipLevel(value: number): void {
        this._mipLevel = Math.max(0, Math.min(20, Math.floor(value)));
    }

    public setHzbRenderer(value: HzbRenderer): void {
        this._webgpuHzb?.setRenderer(value);
    }

    public setDepthSource(value: DepthSource): void {
        this._depth.setSource(value);
    }

    public setDepthEncoding(value: DepthEncoding): void {
        this._depth.setEncoding(value);
    }

    public setTester(value: TesterMode): void {
        if (value === TesterMode.HZB && !this.hzbAvailable) {
            return;
        }
        if (value === TesterMode.Queries && !this.queriesAvailable) {
            return;
        }
        if (value === TesterMode.Coverage && !this.coverageAvailable) {
            return;
        }
        this._tester = value;
        this._applyTester();
    }

    public setCapacity(value: number): void {
        const next = Math.max(1, Math.floor(value));
        if (next === this._capacity) {
            return;
        }

        const previousWalls = wallCount(this._capacity);
        this._unlockObjects();
        this._capacity = next;
        this._resizeTesters(next);
        if (next < this._objects.length) {
            this._dropObjectsFrom(next);
        }
        if (wallCount(next) !== previousWalls && this._positions.length > 0) {
            this._layoutWalls();
            separateOverlaps(
                this.root.getPosition(),
                this._positions,
                this._scales,
                this._shapes,
                wallCount(next),
            );
            this._writeTransforms();
        }
        if (next > this._objects.length) {
            const previous = this._objects.length;
            this._fillNewSlots(previous);
            this._spawnNewObjects(previous);
        }
        this._applyTester();
    }

    public setRadius(value: number): void {
        const next = Math.max(1, value);
        if (next === this._radius) {
            return;
        }

        const ratio = next / this._radius;
        this._radius = next;
        const walls = wallCount(this._capacity);
        const center = this.root.getPosition();

        for (let i = 0; i < this._objects.length; i++) {
            if (i < walls) {
                layoutWall(i, walls, next, center, this._positions[i], this._scales[i]);
            } else {
                scaleScatterAboutCenter(this._positions[i], this._scales[i], center, ratio);
                this._positions[i].y = this._scales[i].y * 0.5;
            }
        }
        separateOverlaps(center, this._positions, this._scales, this._shapes, walls);
        this._writeTransforms();
        for (const object of this._objects) {
            object.lock();
        }
    }

    public setObjectScale(value: number): void {
        const next = Math.min(OBJECT_SCALE_MAX, Math.max(OBJECT_SCALE_MIN, value));
        if (Math.abs(next - this._objectScale) < 1e-4) {
            return;
        }

        const ratio = next / this._objectScale;
        this._objectScale = next;
        const walls = wallCount(this._capacity);
        for (let i = walls; i < this._scales.length; i++) {
            this._scales[i].mulScalar(ratio);
            this._positions[i].y = this._scales[i].y * 0.5;
        }
        if (ratio > 1 && this._scales.length > walls) {
            separateOverlaps(this.root.getPosition(), this._positions, this._scales, this._shapes, walls);
        }
        if (this._objects.length === 0) {
            return;
        }
        this._writeTransforms();
        for (const object of this._objects) {
            object.lock();
        }
    }

    public destroy(): void {
        this._precullHandle?.off();
        this._updateHandle?.off();
        this._postRenderLayerHandle?.off();
        this._frameUpdateHandle?.off();
        this._frameEndHandle?.off();
        this._precullHandle = null;
        this._updateHandle = null;
        this._postRenderLayerHandle = null;
        this._frameUpdateHandle = null;
        this._frameEndHandle = null;
        this._depth.release();
        this._clearObjects();
        this.root.destroy();
        this._webgl2Hzb?.destroy();
        this._webgl2Queries?.destroy();
        this._webgpuHzb?.destroy();
        this._coverage?.destroy();
        this._aabbStore.destroy();
        this._wallMaterial.destroy();
        for (const material of this._materials) {
            material.destroy();
        }
    }

    private get _camera(): Camera | null {
        return this._cameraEntity.camera?.camera ?? null;
    }

    private _createMaterial(color: Color): StandardMaterial {
        const material = new StandardMaterial();
        material.diffuse = color;
        material.gloss = 0.35;
        material.metalness = 0;
        material.useMetalness = true;
        material.update();
        return material;
    }

    private _materialFor(index: number): StandardMaterial {
        if (index < wallCount(this._capacity)) {
            return this._wallMaterial;
        }
        return this._materials[index % this._materials.length];
    }

    private _resizeTesters(capacity: number): void {
        this._aabbStore.resize(capacity);
        this._webgl2Hzb?.resize();
        this._webgl2Queries?.resize();
        this._webgpuHzb?.resize();
        this._coverage?.resize(capacity);
    }

    private _applyTester(): void {
        const pyramid = this._tester === TesterMode.HZB || this._tester === TesterMode.Coverage;
        this._webgl2Hzb?.setEnabled(pyramid);
        this._webgpuHzb?.setEnabled(pyramid);
        if (this._tester === TesterMode.Coverage) {
            this._coverage?.activate();
        } else {
            this._coverage?.deactivate(this._camera);
        }

        const tester = this._currentTester();
        for (const object of this._objects) {
            object.occlusionTester = tester;
        }
    }

    private _currentTester(): IOcclusionCullingTester | null {
        if (this._tester === TesterMode.HZB) {
            return this._webgl2Hzb?.tester ?? this._webgpuHzb?.tester ?? null;
        }
        if (this._tester === TesterMode.Queries) {
            return this._webgl2Queries?.tester ?? null;
        }
        if (this._tester === TesterMode.Coverage) {
            return this._coverage?.gate ?? null;
        }
        return null;
    }

    private _unlockObjects(): void {
        for (const object of this._objects) {
            object.unlock();
        }
    }

    private _fillNewSlots(from: number): void {
        const walls = wallCount(this._capacity);
        const center = this.root.getPosition();
        const placement = new ObjectPlacement(this._radius, center);

        for (let i = 0; i < from; i++) {
            placement.add(this._positions[i], this._scales[i], this._shapes[i], true);
        }

        const scatter: number[] = [];
        for (let i = from; i < this._capacity; i++) {
            const position = new Vec3();
            const scale = new Vec3();
            this._positions[i] = position;
            this._scales[i] = scale;
            if (i < walls) {
                layoutWall(i, walls, this._radius, center, position, scale);
                this._shapes[i] = 'box';
                placement.add(position, scale, 'box', true);
                continue;
            }
            placement.prepareScatter(scale, this._objectScale);
            position.y = scale.y * 0.5;
            this._shapes[i] = scatterShape(i);
            scatter.push(i);
        }

        scatter.sort((a, b) => this._scales[b].x - this._scales[a].x);
        for (let i = 0; i < scatter.length; i++) {
            const index = scatter[i];
            placement.place(this._positions[index], this._scales[index], this._shapes[index]);
        }
        placement.relax(true);
    }

    private _layoutWalls(): void {
        const walls = wallCount(this._capacity);
        const center = this.root.getPosition();
        const count = Math.min(walls, this._positions.length);
        for (let i = 0; i < count; i++) {
            layoutWall(i, walls, this._radius, center, this._positions[i], this._scales[i]);
        }
    }

    private _writeTransforms(): void {
        for (let i = 0; i < this._objects.length; i++) {
            const entity = this._objects[i].entity;
            entity.setPosition(this._positions[i]);
            entity.setLocalScale(this._scales[i]);
        }
        this._app.root.syncHierarchy();
    }

    private _spawnNewObjects(from: number): void {
        const tester = this._currentTester();
        const entities: Entity[] = [];

        for (let i = from; i < this._capacity; i++) {
            const entity = new Entity(`occludee-${i}`);
            entity.setPosition(this._positions[i]);
            entity.setLocalScale(this._scales[i]);
            entity.addComponent('render', {
                type: this._shapes[i],
                material: this._materialFor(i),
                castShadows: false,
            });
            this.root.addChild(entity);
            entities.push(entity);
        }

        this._app.root.syncHierarchy();

        for (let i = 0; i < entities.length; i++) {
            this._objects[from + i] = new CullingObject(entities[i], tester);
        }
    }

    private _dropObjectsFrom(index: number): void {
        for (let i = index; i < this._objects.length; i++) {
            this._destroyObject(this._objects[i]);
        }
        this._objects.length = index;
        this._positions.length = index;
        this._scales.length = index;
        this._shapes.length = index;
    }

    private _destroyObject(object: CullingObject): void {
        this.root.removeChild(object.entity);
        object.destroy();
    }

    private _clearObjects(): void {
        for (const object of this._objects) {
            this._destroyObject(object);
        }
        this._objects.length = 0;
    }

    private _onFrameUpdate = (dt: number): void => {
        if (this._drawHZB && this._tester === TesterMode.HZB) {
            this._webgl2Hzb?.drawOverlay();
            this._webgpuHzb?.drawOverlay();
        }
        this._webgl2Hzb?.frameUpdate(dt);
        this._webgl2Queries?.frameUpdate(dt);
        this._webgpuHzb?.frameUpdate(dt);
        this._coverage?.frameUpdate(dt);
        if (this._drawHZB && this._tester === TesterMode.Coverage) {
            this._coverage?.drawOverlay();
        }
    };

    private _onFrameEnd = (): void => {
        const camera = this._camera;
        if (!this._autoUpdate || !camera) {
            return;
        }
        if (this._tester !== TesterMode.HZB && this._tester !== TesterMode.Coverage) {
            return;
        }

        this._updatePyramids(camera);
        if (this._tester === TesterMode.Coverage) {
            this._captureCoverage(camera);
        }
    };

    private _updatePyramids(camera: Camera): void {
        const useSceneDepth = this._depth.useSceneDepthMap;
        if (this._tester === TesterMode.HZB) {
            this._webgl2Hzb?.update(camera, useSceneDepth);
        } else {
            this._webgl2Hzb?.updatePyramid(camera, useSceneDepth);
        }
        this._webgpuHzb?.updatePyramid(camera, useSceneDepth);
    }

    private _captureCoverage(camera: Camera): void {
        const pyramid = this._webgl2Hzb?.pyramid ?? this._webgpuHzb?.pyramid;
        if (pyramid) {
            this._coverage?.capture(pyramid, camera);
        }
    }

    private _onPostRenderLayer = (cameraComponent: CameraComponent, layer: Layer, transparent: boolean): void => {
        if (transparent || !this._autoUpdate || this._tester !== TesterMode.Queries) {
            return;
        }
        const camera = this._camera;
        if (!camera || camera !== cameraComponent.camera || layer.name !== QUERIES_LAYER_NAME) {
            return;
        }
        this._webgl2Queries?.execute(camera);
    };

    private _onPrecull = (cullCameraComponent: CameraComponent): void => {
        if (this._cameraEntity.camera !== cullCameraComponent) {
            return;
        }

        const camera = cullCameraComponent.camera;
        this._drawFullscreenMip();

        if (this._tester === TesterMode.HZB && this._webgpuHzb) {
            this._handleIndirectDraw(this._webgpuHzb, camera);
            return;
        }
        if (!this._autoUpdate) {
            return;
        }

        this._cullObjects(camera);
        if (this._tester === TesterMode.Coverage) {
            this._coverage?.execute(camera);
        }
    };

    private _drawFullscreenMip(): void {
        if (!this._debugMipLevel) {
            return;
        }
        if (this._tester === TesterMode.Coverage) {
            this._coverage?.drawFullscreen(this._coverageFullscreenDownloaded);
            return;
        }
        this._webgl2Hzb?.debugMipLevel(this._mipLevel);
        this._webgpuHzb?.debugMipLevel(this._mipLevel);
    }

    private _cullObjects(camera: Camera): void {
        for (let i = 0; i < this._objects.length; i++) {
            const object = this._objects[i];
            object.handle(camera.frustum);
            if (this._isDebugTarget(object, i)) {
                this._drawObjectDebug(object);
            }
        }
    }

    private _isDebugTarget(object: CullingObject, index: number): boolean {
        return this._debug &&
            this._debugItemIdx === index &&
            object.frustumStatus !== FRUSTUM_OUTSIDE;
    }

    private _drawObjectDebug(object: CullingObject): void {
        const index = object.occlusionCullingIndex;
        if (this._tester === TesterMode.HZB) {
            this._webgl2Hzb?.debugItem(index, this._debugBox, this._debugRect, this._debugMipLevel);
        } else if (this._tester === TesterMode.Queries) {
            this._webgl2Queries?.debugItem(index, this._debugBox);
        } else if (this._tester === TesterMode.Coverage) {
            this._coverage?.debugItem(index, this._debugBox, this._debugRect);
        }
    }

    private _handleIndirectDraw(backend: WebgpuHzbOcclusion, camera: Camera): void {
        for (let i = 0; i < this._objects.length; i++) {
            const object = this._objects[i];
            const meshInstance = object.entity.render?.meshInstances[0];
            object.handle(camera.frustum);

            if (object.frustumStatus !== FRUSTUM_OUTSIDE && meshInstance) {
                const slot = this._app.graphicsDevice.getIndirectDrawSlot();
                const primitive = meshInstance.mesh?.primitive[meshInstance.renderStyle];
                if (primitive) {
                    meshInstance.setIndirect(null, slot, 1);
                    backend.tester.enqueue(object.occlusionCullingIndex, slot, primitive, 1, 0);
                    object.drawn = true;
                }

                if (this._debug && this._debugItemIdx === i) {
                    backend.debugItem(
                        object.occlusionCullingIndex,
                        this._debugBox,
                        this._debugRect,
                        this._debugMipLevel,
                    );
                }
            }
        }

        backend.tester.execute(camera, this._autoUpdate);
    }

    private _onUpdate = (): void => {
        const keyboard = this._app.keyboard;
        if (!keyboard) {
            return;
        }

        if (keyboard.wasPressed(KEY_B)) {
            this._debugBox = !this._debugBox;
        }
        if (keyboard.wasPressed(KEY_R)) {
            this._debugRect = !this._debugRect;
        }
        if (keyboard.wasPressed(KEY_C)) {
            this._debugItemIdx = this._debugItemIdx === -1 ? 0 : -1;
        }
        if (this._debugItemIdx === -1) {
            return;
        }

        let index = this._debugItemIdx;
        let changed = false;
        if (keyboard.wasPressed(KEY_ADD) || keyboard.wasPressed(KEY_EQUAL)) {
            index += 1;
            changed = true;
        }
        if (keyboard.wasPressed(KEY_SUBTRACT)) {
            index -= 1;
            changed = true;
        }
        if (changed) {
            this._debugItemIdx = wrapIndex(index, this._objects.length);
        }
    };
}

const OBJECT_SCALE_MIN = 0.25;
const OBJECT_SCALE_MAX = 2.5;

function wrapIndex(index: number, length: number): number {
    if (length <= 0) {
        return 0;
    }
    const wrapped = index % length;
    return wrapped < 0 ? wrapped + length : wrapped;
}
