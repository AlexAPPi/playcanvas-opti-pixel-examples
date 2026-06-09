import {
    FRUSTUM_UNKNOWN, FRUSTUM_CONTAINED, FRUSTUM_INTERSECTS, FRUSTUM_OUTSIDE,
    OCCLUSION_UNKNOWN, OCCLUSION_OCCLUDED, OCCLUSION_VISIBLE,
    OcclusionCullingSystem,
    IOcclusionCullingTester,
    isGPU2CPUReadbackOcclusionCullingTester,
    isGPUIndirectDrawOcclusionCullingTester,
    IGPUIndirectDrawOcclusionCullingTester,
    AABBStore
} from "playcanvas-opti-pixel";

type TFrustumResult = typeof FRUSTUM_UNKNOWN | typeof FRUSTUM_CONTAINED | typeof FRUSTUM_INTERSECTS | typeof FRUSTUM_OUTSIDE;
type TOcclusionResult = typeof OCCLUSION_UNKNOWN | typeof OCCLUSION_OCCLUDED | typeof OCCLUSION_VISIBLE;

const _tempSphere = new pc.BoundingSphere();

export class CullingObject {

    private _occlusionTester: IOcclusionCullingTester | null;
    private _meshInstance: pc.MeshInstance;
    private _visible: boolean;

    public readonly entity: pc.Entity;
    public hzbTesterIndex: number | undefined;
    public oqTesterIndex: number | undefined;
    public outsideFrameStreak = 0;
    public occludedFrameStreak = 0;
    public outsideStreakThreshold = 1;
    public occludedStreakThreshold = 3;
    public frustumStatus: TFrustumResult = FRUSTUM_UNKNOWN;
    public occlusionStatus: TOcclusionResult = OCCLUSION_UNKNOWN;
    public occlusionCullingIndex: number = -1;

    public get occlusionTester() {
        return this._occlusionTester;
    }

    public set occlusionTester(value) {
        this.unlock();
        this._occlusionTester = value;
        this.lock();
    }

    constructor(
        entity: pc.Entity,
        occlusionTester: IOcclusionCullingTester | null,
    ) {
        this.entity = entity;
        this._meshInstance = entity.render!.meshInstances[0];
        this._meshInstance.isVisibleFunc = (camera: pc.Camera) => {
            return this._meshInstance.visible && this._visible;
        }
        this._visible = this._meshInstance.visible;
        this.occlusionTester = occlusionTester;
    }

    public handle(frustum: pc.Frustum) {

        if (!this._meshInstance.visible) {
            return;
        }

        // this line evaluates aabb
        const aabb = this._meshInstance.aabb;

        // @ts-ignore
        _tempSphere.center = aabb.center;
        _tempSphere.radius = aabb.halfExtents.length();

        const visibleInFrustum = frustum.containsSphere(_tempSphere) as TFrustumResult;

        let occlusionStatus: TOcclusionResult = OCCLUSION_UNKNOWN;
        let finishVisible = visibleInFrustum !== FRUSTUM_OUTSIDE;

        if (isGPU2CPUReadbackOcclusionCullingTester(this.occlusionTester)) {

            if (finishVisible) {
                this.outsideFrameStreak = 0;
            }
            else {

                this.outsideFrameStreak++;

                if (this.outsideFrameStreak >= this.outsideStreakThreshold) {

                    finishVisible = false;
                }
            }

            if (finishVisible && this.occlusionCullingIndex !== -1) {

                occlusionStatus = this.occlusionTester.getOcclusionStatus(this.occlusionCullingIndex);

                if (occlusionStatus === OCCLUSION_OCCLUDED) {

                    this.occludedFrameStreak++;

                    if (this.occludedFrameStreak > this.occludedStreakThreshold) {

                        finishVisible = false;
                    }
                }
                else {

                    this.occludedFrameStreak = 0;
                }
            }
            else {

                this.occludedFrameStreak = 0;
            }

            if (visibleInFrustum !== FRUSTUM_OUTSIDE &&
                visibleInFrustum !== FRUSTUM_INTERSECTS) {
                this.occlusionTester.enqueue(this.occlusionCullingIndex);
            }
        }

        this._visible = finishVisible;
        this.occlusionStatus = occlusionStatus;
        this.frustumStatus = visibleInFrustum;
    }

    protected _getAABB() {
        return this._meshInstance.aabb;
    }

    protected _getMatrix() {
        return undefined; //this.entity.getWorldTransform();
    }

    public unlock() {

        this.outsideFrameStreak = 0;
        this.occludedFrameStreak = 0;

        if (this.occlusionCullingIndex !== -1 && this.occlusionTester) {
            this.occlusionTester.unlock(this.occlusionCullingIndex);
            this.occlusionCullingIndex = -1;
        }
    }

    public lock() {
        this.unlock();
        const aabb = this._getAABB();
        const matrix = this._getMatrix();
        if (this.occlusionTester) {
            this.occlusionCullingIndex = this.occlusionTester.lock(aabb, matrix);
        }
    }

    public destroy() {
        this.unlock();
        this.entity.destroy();
    }
}

export enum Tester {
    None,
    HZB,
    Queries,
}

export class OcclusionSystemScript extends pc.ScriptType {

    public declare autoRender: boolean;
    public declare debug: boolean;
    public declare debugMipLevel: boolean;
    public declare mipLevel: number;
    public declare cameraEntity: pc.Entity;
    public declare layerName: string;
    public declare radius: number;
    public declare capacity: number;
    public declare tester: Tester;

    private _aabbStore: AABBStore;
    private _occlusionSystem: OcclusionCullingSystem;
    private _debugItemIdx: number = -1;
    private _debugReact: boolean = true;
    private _debugBox: boolean = true;

    private _shapesType = [
        'box' as const,
        'sphere' as const,
        'cylinder' as const
    ];

    private _positions: pc.Vec3[] = [];
    private _objects: CullingObject[] = [];

    public postInitialize(): void {

        this._aabbStore = new AABBStore(this.app.graphicsDevice, this.capacity);
        this._occlusionSystem = new OcclusionCullingSystem(this.app, this._aabbStore);
        this._occlusionSystem.active = this.autoRender;
        this._occlusionSystem.queriesLayerName = this.layerName;
        this._occlusionSystem.camera = this.cameraEntity.camera?.camera || null;

        if (this._occlusionSystem.hzb) {
            this._occlusionSystem.hzb.enabled = this.tester === Tester.HZB;

            if ((this._occlusionSystem.hzb as any).maxSize) {
                (this._occlusionSystem.hzb as any).maxSize = 512;
            }
        }

        if (this._occlusionSystem.hzbDebugger) {
            this._occlusionSystem.hzbDebugger.enabled = this.tester === Tester.HZB;
        }

        console.log(this._occlusionSystem);

        this.on("disable", () => {
            this._clearPositions();
            this._clearObjects();
        });

        this.on("attr:autoRender", () => {
            this._occlusionSystem.active = this.autoRender;
        });

        this.on("attr:cameraEntity", () => {
            this._occlusionSystem.camera = this.cameraEntity.camera?.camera || null;
        });

        this.on("attr:layerName", () => {
            this._occlusionSystem.queriesLayerName = this.layerName;
        });

        this.on("attr:tester", () => {
            if (this._occlusionSystem.hzb) {
                this._occlusionSystem.hzb.enabled = this.tester === Tester.HZB;
            }
            if (this._occlusionSystem.hzbDebugger) {
                this._occlusionSystem.hzbDebugger.enabled = this.tester === Tester.HZB;
            }
            this._updateTester();
        });

        this.on("attr:capacity", () => {
            this._unlockObjects();
            this._aabbStore.resize(this.capacity);
            this._occlusionSystem.resize();
            this._updateWorld();
            this._updateTester();
        });

        this.on("attr:radius", () => {
            this._randAndUpdatePositions();
        });

        this.app.scene.on(pc.EVENT_PRECULL, (cullCameraComponent: pc.CameraComponent) => {

            if (this.cameraEntity.camera !== cullCameraComponent) {
                return;
            }

            const camera = cullCameraComponent.camera;
            const frustum = camera.frustum;
            const hzbDebugger = this._occlusionSystem.hzbDebugger;

            if (this.debugMipLevel) {
                hzbDebugger?.debugMipLevel(this.mipLevel);
            }

            // For indirect draw we must always update buffer
            if (this.tester === Tester.HZB) {
                const tester = this._occlusionSystem.hzbTester;
                if (isGPUIndirectDrawOcclusionCullingTester(tester)) {
                    this._handleIndirectDraw(tester, camera);
                    return;
                }
            }

            // Hanlde occlusion queries or gpc2cpu hzb tester
            if (this.autoRender) {

                const sysDebugger = (
                    this.tester === Tester.HZB ? this._occlusionSystem.hzbDebugger : 
                    this.tester === Tester.Queries ? this._occlusionSystem.queriesDebugger :
                    null
                );

                for (let i = 0; i < this._objects.length; i++) {

                    const object = this._objects[i];
                    object.handle(frustum);

                    if (this.debug && this._debugItemIdx === i) {

                        if (object.frustumStatus !== FRUSTUM_OUTSIDE) {

                            sysDebugger?.debugItem(
                                object.occlusionCullingIndex,
                                this._debugBox, this._debugReact, this.debugMipLevel
                            );
                        }
                    }
                }
            }
        });

        this._updateWorld();
    }

    private _handleIndirectDraw(tester: IGPUIndirectDrawOcclusionCullingTester, camera: pc.Camera) {

        const hzbDebugger = this._occlusionSystem.hzbDebugger;

        for (let i = 0; i < this._objects.length; i++) {

            const object = this._objects[i];
            const meshInstance = object.entity.render?.meshInstances[0]!;

            object.handle(camera.frustum);

            if (object.frustumStatus !== FRUSTUM_OUTSIDE && meshInstance) {

                const slot = this.app.graphicsDevice.getIndirectDrawSlot();
                const prim = meshInstance.mesh?.primitive[meshInstance.renderStyle];

                meshInstance.setIndirect(null, slot, 1);
                tester.enqueue(object.occlusionCullingIndex, prim, slot, 1, 0);

                if (this.debug && this._debugItemIdx === i) {
                    hzbDebugger?.debugItem(
                        object.occlusionCullingIndex,
                        this._debugBox, this._debugReact, this.debugMipLevel
                    );
                }
            }
        }

        tester.execute(camera, this.autoRender);
    }

    private _destroyCullObject(object: CullingObject) {
        this.entity.removeChild(object.entity);
        object.destroy();
    }

    private _updateWorld() {
        this._fillRandPositions();
        this._spawnObjects();
    }

    private _clearPositions() {
        this._positions.length = 0;
    }

    private _clearObjects() {

        this._objects.forEach(obj => {
            this._destroyCullObject(obj);
        });

        this._objects.length = 0;
    }

    private _updateCullPosition(object: CullingObject, position: pc.Vec3) {
        object.entity.setPosition(position);
        object.lock();
    }

    private _randAndUpdatePositions() {

        this._clearPositions();
        this._fillRandPositions();

        for (let i = 0; i < this._objects.length; i++) {

            this._updateCullPosition(
                this._objects[i],
                this._positions[i]
            );
        }
    }

    private _fillRandPositions() {

        const prevCount = this._positions?.length ?? 0;

        this._positions ??= new Array(this.capacity);
        this._positions.length = this.capacity;

        if (prevCount >= this.capacity) {
            return;
        }

        const center = this.entity.getPosition();
        const radius = this.radius;

        let i = prevCount < this.capacity ? prevCount: 0;

        for (; i < this.capacity; i++) {
            this._positions[i] = randomPointInSphere(center, radius);
        }
    }

    private _getRandomShape() {
        const index = Math.floor(Math.random() * this._shapesType.length);
        return this._shapesType[index];
    }

    private _getTester() {
        return (
            this.tester === Tester.HZB ? this._occlusionSystem.hzbTester :
            this.tester === Tester.Queries ? this._occlusionSystem.queriesTester :
            null
        );
    }

    private _updateTester() {
        const tester = this._getTester();
        for (const object of this._objects) {
            object.occlusionTester = tester;
        }
    }

    private _unlockObjects() {
        for (let i = 0; i < this._objects.length; i++) {
            this._objects[i].unlock();
        }
    }

    private _spawnObjects() {

        const prevCount = this._objects?.length ?? 0;

        this._objects ??= new Array(this.capacity);

        if (prevCount > this.capacity) {

            for (let i = this.capacity; i < prevCount; i++) {
                const object = this._objects[i];
                this._destroyCullObject(object);
            }

            this._objects.length = this.capacity;
            return;
        }

        this._objects.length = this.capacity;

        const tester = this._getTester();

        for (let i = prevCount; i < this.capacity; i++) {

            const entity = new pc.Entity(`TMP_${i}`);
            const type = this._getRandomShape();
            const position = this._positions[i];

            entity.setPosition(position);
            entity.addComponent('render', {
                type: type,
                castShadows: false,
            });

            this.entity.addChild(entity);

            this._objects[i] = new CullingObject(entity, tester);
        }
    }

    public update(dt: number) {

        if (this.app.keyboard?.wasPressed(pc.KEY_B)) {
            this._debugBox = !this._debugBox;
        }

        if (this.app.keyboard?.wasPressed(pc.KEY_R)) {
            this._debugReact = !this._debugReact;
        }

        if (this.app.keyboard?.wasPressed(pc.KEY_C)) {

            if (this._debugItemIdx === -1) {
                this._debugItemIdx = 0;
            } else {
                this._debugItemIdx = -1;
            }
        }

        if (this._debugItemIdx !== -1) {

            let updated = false;

            if (this.app.keyboard?.wasPressed(pc.KEY_ADD)) {
                this._debugItemIdx++;
                updated = true;
            }

            if (this.app.keyboard?.wasPressed(pc.KEY_SUBTRACT)) {
                this._debugItemIdx--;
                updated = true;
            }

            if (updated) {
                this._debugItemIdx = wrapValue(this._debugItemIdx, 0, this._objects.length);
            }
        }
    }
}

function wrapValue(value: number, min: number, max: number): number {
    const range = max - min;
    if (range <= 0) {
        return min;
    }
    let result = (value - min) % range;
    if (result < 0) {
        result += range;
    }
    return result + min;
}

function randomPointInSphere(center: pc.Vec3, radius: number) {

    let point;
    let distance;

    // Rejection sampling: генерируем точку в кубе и проверяем расстояние до центра
    do {
        const x = (Math.random() * 2 - 1) * radius;
        const y = (Math.random() * 2 - 1) * radius;
        const z = (Math.random() * 2 - 1) * radius;
        
        point = center.clone().add(new pc.Vec3(x, y, z));
        distance = point.distance(center);
    } while (distance > radius);
    
    return point;
}

export const occlusionSystemScriptName = "OptiPixel:OcclusionSystemScript";

pc.registerScript(OcclusionSystemScript, occlusionSystemScriptName);

OcclusionSystemScript.attributes.add("autoRender", { type: "boolean", default: true, });
OcclusionSystemScript.attributes.add("debug", { type: "boolean", default: false, });
OcclusionSystemScript.attributes.add("debugMipLevel", { type: "boolean", default: false, });
OcclusionSystemScript.attributes.add("mipLevel", { type: 'number', default: 0, min: 0, max: 20, step: 1, precision: 0, });
OcclusionSystemScript.attributes.add("layerName", { type: "string", default: "World", });
OcclusionSystemScript.attributes.add("cameraEntity", { type: "entity" });
OcclusionSystemScript.attributes.add("radius", { type: 'number', default: 100, min: 0, max: 200, step: 1, precision: 0, });
OcclusionSystemScript.attributes.add("capacity", { type: 'number', default: 100, min: 0, max: 10000, step: 1, precision: 0, });
OcclusionSystemScript.attributes.add("tester", { type: "number", enum: [
    { "None": Tester.None },
    { "HZB": Tester.HZB },
    { "Queries": Tester.Queries },
], default: Tester.HZB, });