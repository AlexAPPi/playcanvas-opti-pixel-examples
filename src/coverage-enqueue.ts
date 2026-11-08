import {
    SOME_ENQUEUE_PROBLEM,
    type CoverageBufferTesterWorker,
    type IGPU2CPUReadbackOcclusionCullingTester,
    type TOcclusionResult,
} from 'playcanvas-opti-pixel';

type OcclusionId = Parameters<IGPU2CPUReadbackOcclusionCullingTester['unlock']>[0];
type QueueIndex = ReturnType<IGPU2CPUReadbackOcclusionCullingTester['enqueue']>;

type CoverageLockArgs = Parameters<CoverageBufferTesterWorker['lock']>;
type CoverageCamera = Parameters<CoverageBufferTesterWorker['execute']>[0];

/**
 * `CoverageBufferTesterWorker` keeps ids that `execute` could not submit while
 * the worker still holds the job bus. Enqueueing those ids again fills the
 * queue. This gate stages one frame and submits it only after the previous
 * queue has been cleared.
 *
 * The hold is not part of the public tester API, so the queue count is read
 * from the tester after `execute`.
 */
export class CoverageEnqueueGate implements IGPU2CPUReadbackOcclusionCullingTester {

    public readonly _ocTesterType = 'gpu2cpu_readback_oct' as const;

    private _held = false;
    private readonly _staged: number[] = [];

    public constructor(private readonly _tester: CoverageBufferTesterWorker) {}

    public lock(boundingBox: CoverageLockArgs[0], matrix?: CoverageLockArgs[1], extra1?: number, extra2?: number): OcclusionId {
        return this._tester.lock(boundingBox, matrix, extra1, extra2);
    }

    public lockMinMaxScalars(
        data: ArrayLike<number>,
        offset: number,
        matrix?: Parameters<CoverageBufferTesterWorker['lockMinMaxScalars']>[2],
        extra1?: number,
        extra2?: number,
    ): OcclusionId {
        return this._tester.lockMinMaxScalars(data, offset, matrix, extra1, extra2);
    }

    public unlock(id: OcclusionId): void {
        this._tester.unlock(id);
    }

    public getOcclusionStatus(id: OcclusionId): TOcclusionResult {
        return this._tester.getOcclusionStatus(id);
    }

    public enqueue(id: OcclusionId, _extra?: number | number[]): QueueIndex {
        if (this._held || id < 0) {
            return SOME_ENQUEUE_PROBLEM;
        }
        this._staged.push(id);
        return this._staged.length - 1;
    }

    public execute(camera: CoverageCamera): void {
        if (!this._held) {
            const staged = this._staged;
            for (let i = 0; i < staged.length; i++) {
                this._tester.enqueue(staged[i]);
            }
            staged.length = 0;
        }

        const before = readCoverageQueueCount(this._tester);
        this._tester.execute(camera);
        const after = readCoverageQueueCount(this._tester);
        this._held = before !== null && after !== null && after > 0;
    }

    public reset(): void {
        this._held = false;
        this._staged.length = 0;
        const queue = (this._tester as unknown as { _queue?: { clear?: () => void } })._queue;
        queue?.clear?.();
    }
}

function readCoverageQueueCount(tester: CoverageBufferTesterWorker): number | null {
    const count = (tester as unknown as { _queue?: { count?: number } })._queue?.count;
    return typeof count === 'number' ? count : null;
}
