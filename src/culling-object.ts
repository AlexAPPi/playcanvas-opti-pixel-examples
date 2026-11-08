import { BoundingSphere, Entity, Frustum, MeshInstance } from 'playcanvas';
import {
    FRUSTUM_INTERSECTS,
    FRUSTUM_OUTSIDE,
    FRUSTUM_UNKNOWN,
    OCCLUSION_OCCLUDED,
    OCCLUSION_UNKNOWN,
    WebglHZBCPUFBTester,
    WebglOcclusionQueriesTester,
    isGPU2CPUReadbackOcclusionCullingTester,
    type IOcclusionCullingTester,
    type TFrustumResult,
    type TOcclusionResult
} from 'playcanvas-opti-pixel';

const _tempSphere = new BoundingSphere();

export class CullingObject {

    public readonly entity: Entity;
    public outsideFrameStreak = 0;
    public occludedFrameStreak = 0;
    public outsideStreakThreshold = 1;
    public occludedStreakThreshold = 3;
    public frustumStatus: TFrustumResult = FRUSTUM_UNKNOWN;
    public occlusionStatus: TOcclusionResult = OCCLUSION_UNKNOWN;
    public occlusionCullingIndex = -1;
    public drawn = true;

    private readonly _meshInstance: MeshInstance;
    private _occlusionTester: IOcclusionCullingTester | null = null;
    private _queriesOrHzb = false;
    private _visible: boolean;

    public get occlusionTester() {
        return this._occlusionTester;
    }

    public set occlusionTester(value: IOcclusionCullingTester | null) {
        this.unlock();
        this._setOcclusionTester(value);
        this.lock();
    }

    public constructor(entity: Entity, occlusionTester: IOcclusionCullingTester | null) {
        this.entity = entity;
        this._meshInstance = entity.render!.meshInstances[0];
        this._meshInstance.isVisibleFunc = () => {
            return this._meshInstance.visible && this._visible;
        };
        this._visible = this._meshInstance.visible;
        this._setOcclusionTester(occlusionTester);
        this.lock();
    }

    public handle(frustum: Frustum): void {
        if (!this._meshInstance.visible) {
            this.drawn = false;
            return;
        }

        const frustumStatus = this._testFrustum(frustum);
        const visibility = this._resolveVisibility(frustumStatus);
        this._visible = visibility.visible;
        this.drawn = visibility.visible;
        this.occlusionStatus = visibility.occlusion;
        this.frustumStatus = frustumStatus;
    }

    public unlock(): void {
        this.outsideFrameStreak = 0;
        this.occludedFrameStreak = 0;

        if (this.occlusionCullingIndex !== -1 && this._occlusionTester) {
            this._occlusionTester.unlock(this.occlusionCullingIndex);
            this.occlusionCullingIndex = -1;
        }
    }

    public lock(): void {
        this.unlock();
        if (this._occlusionTester) {
            this.occlusionCullingIndex = this._occlusionTester.lock(this._meshInstance.aabb);
        }
    }

    public destroy(): void {
        this.unlock();
        this.entity.destroy();
    }

    private _testFrustum(frustum: Frustum): TFrustumResult {
        const aabb = this._meshInstance.aabb;
        _tempSphere.center.copy(aabb.center);
        _tempSphere.radius = aabb.halfExtents.length();
        return frustum.containsSphere(_tempSphere) as TFrustumResult;
    }

    /**
     * CPU readback arrives a few frames late, so an occluded box stays visible
     * until its streak passes the threshold. Queries and WebGL HZB do not
     * enqueue a box that only crosses the frustum edge.
     */
    private _resolveVisibility(frustumStatus: TFrustumResult): { visible: boolean; occlusion: TOcclusionResult } {
        let visible = frustumStatus !== FRUSTUM_OUTSIDE;
        let occlusion: TOcclusionResult = OCCLUSION_UNKNOWN;
        const tester = this._occlusionTester;
        if (!isGPU2CPUReadbackOcclusionCullingTester(tester)) {
            return { visible, occlusion };
        }

        if (visible) {
            this.outsideFrameStreak = 0;
        } else {
            this.outsideFrameStreak++;
            if (this.outsideFrameStreak >= this.outsideStreakThreshold) {
                visible = false;
            }
        }

        if (visible && this.occlusionCullingIndex !== -1) {
            occlusion = tester.getOcclusionStatus(this.occlusionCullingIndex);
            if (occlusion === OCCLUSION_OCCLUDED) {
                this.occludedFrameStreak++;
                if (this.occludedFrameStreak > this.occludedStreakThreshold) {
                    visible = false;
                }
            } else {
                this.occludedFrameStreak = 0;
            }
        } else {
            this.occludedFrameStreak = 0;
        }

        const crossingFrustum = frustumStatus === FRUSTUM_INTERSECTS;
        const skipEnqueue = this._queriesOrHzb && crossingFrustum;
        if (frustumStatus !== FRUSTUM_OUTSIDE && !skipEnqueue) {
            tester.enqueue(this.occlusionCullingIndex);
        }

        return { visible, occlusion };
    }

    private _setOcclusionTester(value: IOcclusionCullingTester | null): void {
        this._occlusionTester = value;
        this._queriesOrHzb = value !== null && isQueriesOrHzbTester(value);
    }
}

function isQueriesOrHzbTester(tester: IOcclusionCullingTester): boolean {
    return tester instanceof WebglOcclusionQueriesTester ||
        tester instanceof WebglHZBCPUFBTester;
}
