import {
    FRUSTUM_UNKNOWN, FRUSTUM_CONTAINED, FRUSTUM_INTERSECTS, FRUSTUM_OUTSIDE,
    OCCLUSION_UNKNOWN, OCCLUSION_OCCLUDED, OCCLUSION_VISIBLE,
    OcclusionCullingSystem,
    isGPU2CPUReadbackOcclusionCulling,
    IOcclusionCullingTester
} from "playcanvas-opti-pixel";

type TFrustumResult = typeof FRUSTUM_UNKNOWN | typeof FRUSTUM_CONTAINED | typeof FRUSTUM_INTERSECTS | typeof FRUSTUM_OUTSIDE;
type TOcclusionResult = typeof OCCLUSION_UNKNOWN | typeof OCCLUSION_OCCLUDED | typeof OCCLUSION_VISIBLE;

const _tempSphere = new pc.BoundingSphere();

export class CullingObject {

    private _meshInstance: pcx.MeshInstance;
    private _visible: boolean;

    public hzbTesterIndex: number | undefined;
    public oqTesterIndex: number | undefined;
    public outsideFrameStreak = 0;
    public occludedFrameStreak = 0;
    public outsideStreakThreshold = 1;
    public occludedStreakThreshold = 3;
    public frustumStatus: TFrustumResult = FRUSTUM_UNKNOWN;
    public occlusionStatus: TOcclusionResult = OCCLUSION_UNKNOWN;
    public occlusionCullingIndex: number = -1;

    constructor(
        public readonly entity: pcx.Entity,
        public occlusionTester: IOcclusionCullingTester,
    ) {
        this._meshInstance = entity.render!.meshInstances[0];
        this._meshInstance.isVisibleFunc = (camera: pcx.Camera) => {
            return this._meshInstance.visible && this._visible;
        }
        this._visible = this._meshInstance.visible;
        this.lock();
    }

    public handle(frustum: pcx.Frustum) {

        if (!this._meshInstance.visible) {
            return;
        }

        // @ts-ignore
        _tempSphere.center = this._meshInstance.aabb.center; // this line evaluates aabb
        // @ts-ignore
        _tempSphere.radius = this._meshInstance._aabb.halfExtents.length();

        const visibleInFrustum = frustum.containsSphere(_tempSphere) as TFrustumResult;

        let occlusionStatus: TOcclusionResult = OCCLUSION_UNKNOWN;
        let finishVisible = visibleInFrustum !== FRUSTUM_OUTSIDE;

        if (isGPU2CPUReadbackOcclusionCulling(this.occlusionTester)) {

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

                    if (this.occludedFrameStreak >= this.occludedStreakThreshold) {
                        
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

        if (this.occlusionCullingIndex !== -1) {

            this.occlusionTester.unlock(this.occlusionCullingIndex);
            this.occlusionCullingIndex = -1;
        }
    }

    public lock() {
        this.unlock();
        const aabb = this._getAABB();
        const matrix = this._getMatrix();
        this.occlusionCullingIndex = this.occlusionTester.lock(aabb, matrix);
    }

    public destroy() {
        this.unlock();
        this.entity.destroy();
    }
}

export enum Tester {
    HZB,
    Queries,
}

export class OcclusionSystemScript extends pc.ScriptType {

    public declare autoRender: boolean;
    public declare debug: boolean;
    public declare debugMipLevel: boolean;
    public declare mipLevel: number;
    public declare cameraEntity: pcx.Entity;
    public declare layerName: string;
    public declare radius: number;
    public declare capacity: number;
    public declare tester: Tester;

    private _occlusionSystem: OcclusionCullingSystem;

    private _shapesType = [
        'box' as const,
        'sphere' as const,
        'cylinder' as const
    ];

    private _positions: pcx.Vec3[] = [];
    private _objects: CullingObject[] = [];

    public postInitialize(): void {

        this._occlusionSystem = new OcclusionCullingSystem(this.app, this.capacity);
        this._occlusionSystem.active = true;
        this._occlusionSystem.queriesLayerName = this.layerName;
        this._occlusionSystem.camera = this.cameraEntity.camera?.camera || null;

        this.on("disable", () => {
            this._clearPositions();
            this._clearObjects();
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
            this._updateTester();
        });

        this.on("attr:capacity", () => {
            this._occlusionSystem.resize(this.capacity);
            this._updateWorld();
        });

        this.on("attr:radius", () => {
            this._randAndUpdatePositions();
        });

        this.app.scene.on("precull", (cullCamera) => {

            if (this.autoRender) {

                const camera = this.cameraEntity.camera!;

                if (camera === cullCamera) {

                    const frustum = camera.frustum;
                    const hzbDebugger = this._occlusionSystem.hzbDebugger;

                    if (this.debugMipLevel) {
                        hzbDebugger?.debugMipLevel(this.mipLevel);
                    }

                    for (let i = 0; i < this._objects.length; i++) {

                        const object = this._objects[i];

                        object.handle(frustum);

                        if (this.debug && object.frustumStatus !== FRUSTUM_OUTSIDE) {

                            hzbDebugger?.debugItem(
                                object.occlusionCullingIndex,
                                true, true, this.debugMipLevel
                            );
                        }
                    }
                }
            }
        });

        this._updateWorld();
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

    private _updateCullPosition(object: CullingObject, position: pcx.Vec3) {
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

    private _updateTester() {

        const tester = (this.tester === Tester.HZB ?
            this._occlusionSystem.hzbTester :
            this._occlusionSystem.queriesTester
        )!;

        for (const object of this._objects) {
            object.occlusionTester = tester;
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

        const tester = (this.tester === Tester.HZB ?
            this._occlusionSystem.hzbTester :
            this._occlusionSystem.queriesTester
        )!;

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
}

function randomPointInSphere(center: pcx.Vec3, radius: number) {

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
    { "HZB": Tester.HZB },
    { "Queries": Tester.Queries }
], default: Tester.HZB, });