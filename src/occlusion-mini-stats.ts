import {
    AppBase,
    MiniStats,
} from 'playcanvas';
import type { ICoverageBufferStats, ICoverageReadbackStats } from 'playcanvas-opti-pixel';
import type { OcclusionScene } from './occlusion/scene.ts';

interface CoverageStat {
    /** Key in `app.stats.user`. MiniStats paths cannot contain dots. */
    key: string;
    name: string;
    decimalPlaces: number;
    unitsName: string;
    watermark: number;
    read: (readback: ICoverageReadbackStats, worker: ICoverageBufferStats) => number;
}

/**
 * Coverage timings from the library, in sample order.
 * The first four are the GPU read (`ICoverageReadbackStats`).
 * The rest are the last finished worker job (`ICoverageBufferStats`).
 * Times are milliseconds. Counts are the AABBs that job tested.
 */
const COVERAGE_STATS: readonly CoverageStat[] = [
    { key: 'covPack', name: 'Pack', decimalPlaces: 2, unitsName: 'ms', watermark: 4, read: (readback) => readback.packMs },
    { key: 'covRead', name: 'Read', decimalPlaces: 2, unitsName: 'ms', watermark: 8, read: (readback) => readback.readMs },
    { key: 'covLatency', name: 'Latency', decimalPlaces: 1, unitsName: 'ms', watermark: 40, read: (readback) => readback.latencyMs },
    { key: 'covFrames', name: 'Frames', decimalPlaces: 0, unitsName: '', watermark: 8, read: (readback) => readback.latencyFrames },
    { key: 'covCopy', name: 'Copy', decimalPlaces: 2, unitsName: 'ms', watermark: 1, read: (_readback, worker) => worker.copyMs },
    { key: 'covReproject', name: 'Reproject', decimalPlaces: 2, unitsName: 'ms', watermark: 4, read: (_readback, worker) => worker.reprojectMs },
    { key: 'covMip', name: 'Mip', decimalPlaces: 2, unitsName: 'ms', watermark: 4, read: (_readback, worker) => worker.mipMs },
    { key: 'covTest', name: 'Test', decimalPlaces: 2, unitsName: 'ms', watermark: 8, read: (_readback, worker) => worker.aabbTestMs },
    { key: 'covWorker', name: 'Worker', decimalPlaces: 2, unitsName: 'ms', watermark: 16, read: (_readback, worker) => worker.workerMs },
    { key: 'covWait', name: 'Wait', decimalPlaces: 1, unitsName: 'ms', watermark: 33, read: (_readback, worker) => worker.waitMs },
    { key: 'covTested', name: 'Tested', decimalPlaces: 0, unitsName: '', watermark: 1024, read: (_readback, worker) => worker.aabbCount },
    { key: 'covOccluded', name: 'Occluded', decimalPlaces: 0, unitsName: '', watermark: 1024, read: (_readback, worker) => worker.occludedCount },
];

function coverageGraphs(stats: ReturnType<typeof MiniStats.getDefaultOptions>['stats']): void {
    for (const stat of COVERAGE_STATS) {
        stats.push({
            name: stat.name,
            stats: [`user.${stat.key}`],
            decimalPlaces: stat.decimalPlaces,
            unitsName: stat.unitsName,
            watermark: stat.watermark,
        });
    }
}

function publishCoverageStats(scene: OcclusionScene, user: Map<string, number>): void {
    const debug = scene.coverageDebugStats;
    for (const stat of COVERAGE_STATS) {
        const value = debug ? stat.read(debug.readback, debug.worker) : 0;
        user.set(stat.key, Number.isFinite(value) ? value : 0);
    }
}

/**
 * MiniStats with the coverage debug counters in the User section.
 * The publisher is registered before MiniStats so the same `frameupdate`
 * already sees this frame's sample. Scene's own `frameupdate` is registered
 * earlier and has already harvested the GPU read.
 */
export function createOcclusionMiniStats(app: AppBase, scene: OcclusionScene): MiniStats {
    const options = MiniStats.getDefaultOptions();
    options.stats.push({
        name: 'FPS',
        stats: ['frame.fps'],
        decimalPlaces: 0,
        unitsName: 'fps',
        watermark: 60,
    });
    coverageGraphs(options.stats);
    // Compact width fits the longest label beside its value.
    options.sizes[0].width = 168;

    const user = app.stats.user;
    for (const stat of COVERAGE_STATS) {
        user.set(stat.key, 0);
    }

    const publish = (): void => {
        publishCoverageStats(scene, user);
    };
    const handle = app.on('frameupdate', publish);
    const miniStats = new MiniStats(app, options);
    app.on('destroy', () => handle.off());
    return miniStats;
}
