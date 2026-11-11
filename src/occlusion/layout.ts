import { Vec3 } from 'playcanvas';

export type ShapeName = 'box' | 'sphere' | 'cylinder';

const WALL_CAP = 16;
const SCATTER_SHAPES: ShapeName[] = ['box', 'sphere', 'cylinder'];

/** Scatter starts this far behind the wall center, then spreads by `radius`. */
const SCATTER_BEHIND = 6;
/** Gap left when an overlapping pair is pushed apart, so faces do not z-fight. */
const SKIN = 0.02;
const HASH_CELL = 3;
const RANDOM_ATTEMPTS = 36;
const RELAX_ITERATIONS = 32;

export function wallCount(capacity: number): number {
    return Math.min(WALL_CAP, capacity);
}

export function layoutWall(
    index: number,
    walls: number,
    radius: number,
    center: Vec3,
    position: Vec3,
    scale: Vec3,
): void {
    const x = (index - (walls - 1) / 2) * (radius * 0.12);
    position.set(center.x + x, 4, center.z);
    scale.set(radius * 0.1, 6 + (index % 4) * 2, 3);
}

export function scatterShape(index: number): ShapeName {
    return SCATTER_SHAPES[index % SCATTER_SHAPES.length];
}

/** Keep a scatter object's offset from the field center when the radius changes. */
export function scaleScatterAboutCenter(position: Vec3, scale: Vec3, center: Vec3, ratio: number): void {
    position.x = center.x + (position.x - center.x) * ratio;
    position.z = center.z + (position.z - center.z) * ratio;
    scale.mulScalar(ratio);
}

interface Footprint {
    x: number;
    z: number;
    halfX: number;
    halfZ: number;
    round: boolean;
}

interface Body extends Footprint {
    position: Vec3;
    locked: boolean;
}

/**
 * Packs boxes, spheres, and cylinders so their ground footprints overlap as little as possible.
 * Every object stands on the ground, so a collision is an overlap in the horizontal plane:
 * a square for a box, a circle for a sphere or a cylinder.
 */
export class ObjectPlacement {

    private readonly _radius: number;
    private readonly _center: Vec3;
    private readonly _random: () => number;
    private readonly _bodies: Body[] = [];
    private readonly _hash = new FootprintHash();
    private readonly _probe: Footprint = { x: 0, z: 0, halfX: 0, halfZ: 0, round: false };
    private _shiftX = new Float64Array(0);
    private _shiftZ = new Float64Array(0);
    private _maxStep = new Float64Array(0);
    private _lockedX = new Float64Array(0);
    private _lockedZ = new Float64Array(0);
    private _lockedDepth = new Float64Array(0);
    private readonly _lockedIds: number[] = [];
    private _dirty = false;
    private _scatterArea = 0;

    public constructor(radius: number, center: Vec3, random: () => number = Math.random) {
        this._radius = radius;
        this._center = new Vec3(center.x, center.y, center.z);
        this._random = random;
    }

    public add(position: Vec3, scale: Vec3, shape: ShapeName, locked: boolean): void {
        this._add(position, scale, shape, locked);
    }

    public prepareScatter(scale: Vec3, objectScale: number): void {
        const size = (0.35 + this._random() * 1.15) * objectScale;
        const reach = Math.min(this._radius * 0.14, 6.5);
        const height = (0.45 + this._random() * reach) * objectScale;
        scale.set(size, height, size);
    }

    /** Picks a position inside the scatter field. `scale` and `position.y` are already set. */
    public place(position: Vec3, scale: Vec3, shape: ShapeName): void {
        const probe = this._probe;
        probe.halfX = scale.x * 0.5;
        probe.halfZ = scale.z * 0.5;
        probe.round = shape !== 'box';

        let bestGap = Number.NEGATIVE_INFINITY;
        let bestX = this._center.x;
        let bestZ = this._center.z - SCATTER_BEHIND;
        const packed = this._fieldPacked();
        const attempts = packed ? 12 : RANDOM_ATTEMPTS;

        for (let attempt = 0; attempt < attempts; attempt++) {
            this._sample(probe);
            const gap = this._minGap(probe);
            if (gap > bestGap) {
                bestGap = gap;
                bestX = probe.x;
                bestZ = probe.z;
            }
            if (gap >= SKIN) {
                break;
            }
        }

        probe.x = bestX;
        probe.z = bestZ;
        if (bestGap < SKIN && !packed) {
            this._searchGrid(probe, bestGap);
            bestX = probe.x;
            bestZ = probe.z;
        }

        position.x = bestX;
        position.z = bestZ;
        this._add(position, scale, shape, false);
    }

    /**
     * Pushes unlocked footprints apart.
     * `project` keeps them inside the scatter half-disk (used while placing).
     * Radius changes pass `false` so a uniform scale of an existing layout is kept
     * and only real overlaps, mostly against the fixed wall depth, are resolved.
     */
    public relax(project: boolean): void {
        let previous = Number.POSITIVE_INFINITY;
        let stalled = 0;

        for (let iteration = 0; iteration < RELAX_ITERATIONS; iteration++) {
            this._rebuildHash();
            const deficit = this._separate(project);
            this._dirty = true;
            if (deficit <= 1e-3) {
                break;
            }
            if (previous - deficit < previous * 0.01) {
                stalled++;
                if (stalled >= 4 && iteration >= 6) {
                    break;
                }
            } else {
                stalled = 0;
            }
            previous = deficit;
        }

        this._polish(project);
        for (let i = 0; i < this._bodies.length; i++) {
            const body = this._bodies[i];
            if (!body.locked) {
                this._ejectFromLocked(body);
            }
        }
        this._writeBodies();
    }

    private _add(position: Vec3, scale: Vec3, shape: ShapeName, locked: boolean): void {
        const body: Body = {
            x: position.x,
            z: position.z,
            halfX: scale.x * 0.5,
            halfZ: scale.z * 0.5,
            round: shape !== 'box',
            position,
            locked,
        };
        const index = this._bodies.push(body) - 1;
        if (locked) {
            this._lockedIds.push(index);
        }
        if (body.z < this._center.z - 0.5) {
            const width = body.halfX * 2;
            const depth = body.halfZ * 2;
            this._scatterArea += body.round ? Math.PI * body.halfX * body.halfZ : width * depth;
        }
        if (this._dirty) {
            this._rebuildHash();
        } else {
            this._hash.insert(index, body);
        }
    }

    private _fieldPacked(): boolean {
        const field = Math.PI * this._radius * this._radius * 0.5;
        return this._scatterArea > field * 0.9;
    }

    private _sample(out: Footprint): void {
        const distance = this._random() * this._radius;
        const yaw = this._random() * Math.PI * 2;
        out.x = this._center.x + Math.cos(yaw) * distance;
        out.z = this._center.z - SCATTER_BEHIND - Math.abs(Math.sin(yaw)) * distance;
    }

    private _minGap(probe: Footprint): number {
        this._ensureHash();
        const near = this._hash.collect(probe, SKIN);
        let best = Number.POSITIVE_INFINITY;
        for (let i = 0; i < near.length; i++) {
            const gap = rawGap(probe, this._bodies[near[i]]);
            if (gap < best) {
                best = gap;
            }
        }
        return best;
    }

    private _searchGrid(probe: Footprint, bestGap: number): void {
        const area = Math.PI * this._radius * this._radius * 0.5;
        const step = Math.max(Math.sqrt(area / 140), 0.75);
        const anchorX = this._center.x;
        const anchorZ = this._center.z - SCATTER_BEHIND;
        let bestX = probe.x;
        let bestZ = probe.z;

        for (let x = anchorX - this._radius; x <= anchorX + this._radius; x += step) {
            const dx = x - anchorX;
            const limitSq = this._radius * this._radius - dx * dx;
            if (limitSq < 0) {
                continue;
            }
            const limit = Math.sqrt(limitSq);
            for (let z = anchorZ; z >= anchorZ - limit; z -= step) {
                probe.x = x;
                probe.z = z;
                const gap = this._minGap(probe);
                if (gap > bestGap) {
                    bestGap = gap;
                    bestX = x;
                    bestZ = z;
                    if (bestGap >= SKIN) {
                        probe.x = bestX;
                        probe.z = bestZ;
                        return;
                    }
                }
            }
        }

        for (let jitter = 0; jitter < 20; jitter++) {
            const angle = this._random() * Math.PI * 2;
            const distance = this._random() * step;
            this._clampToField(bestX + Math.cos(angle) * distance, bestZ + Math.sin(angle) * distance, probe);
            const gap = this._minGap(probe);
            if (gap > bestGap) {
                bestGap = gap;
                bestX = probe.x;
                bestZ = probe.z;
                if (bestGap >= SKIN) {
                    return;
                }
            }
        }

        probe.x = bestX;
        probe.z = bestZ;
    }

    private _separate(project: boolean): number {
        const bodies = this._bodies;
        const count = bodies.length;
        this._prepareShifts(count);
        const shiftX = this._shiftX;
        const shiftZ = this._shiftZ;
        const maxStep = this._maxStep;
        let deficit = 0;

        for (let i = 0; i < count; i++) {
            const a = bodies[i];
            if (a.locked) {
                continue;
            }
            const near = this._hash.collect(a, SKIN);
            for (let n = 0; n < near.length; n++) {
                const j = near[n];
                if (j === i) {
                    continue;
                }
                const b = bodies[j];
                if (!b.locked && j < i) {
                    continue;
                }
                const push = pushAFromB(a, b);
                if (!push) {
                    continue;
                }
                const depth = Math.hypot(push.x, push.z);
                deficit += depth;
                if (b.locked) {
                    if (depth > this._lockedDepth[i]) {
                        this._lockedDepth[i] = depth;
                        this._lockedX[i] = push.x;
                        this._lockedZ[i] = push.z;
                    }
                    continue;
                }
                const halfX = push.x * 0.5;
                const halfZ = push.z * 0.5;
                const halfDepth = depth * 0.5;
                shiftX[i] += halfX;
                shiftZ[i] += halfZ;
                shiftX[j] -= halfX;
                shiftZ[j] -= halfZ;
                if (halfDepth > maxStep[i]) {
                    maxStep[i] = halfDepth;
                }
                if (halfDepth > maxStep[j]) {
                    maxStep[j] = halfDepth;
                }
            }
        }

        for (let i = 0; i < count; i++) {
            const body = bodies[i];
            if (body.locked) {
                continue;
            }
            if (this._lockedDepth[i] > 0) {
                body.x += this._lockedX[i];
                body.z += this._lockedZ[i];
            } else if (maxStep[i] > 0) {
                let moveX = shiftX[i];
                let moveZ = shiftZ[i];
                const length = Math.hypot(moveX, moveZ);
                const limit = maxStep[i];
                if (length > limit && length > 0) {
                    const scale = limit / length;
                    moveX *= scale;
                    moveZ *= scale;
                }
                body.x += moveX;
                body.z += moveZ;
            } else {
                continue;
            }
            if (project) {
                this._project(body);
            }
            this._ejectFromLocked(body);
            body.position.x = body.x;
            body.position.z = body.z;
        }

        return deficit;
    }

    private _ejectFromLocked(body: Body): void {
        const ids = this._lockedIds;
        if (ids.length === 0) {
            return;
        }
        for (let pass = 0; pass < 4; pass++) {
            let bestX = 0;
            let bestZ = 0;
            let bestHits = Number.POSITIVE_INFINITY;
            let bestLength = Number.POSITIVE_INFINITY;
            let overlapping = false;
            for (let n = 0; n < ids.length; n++) {
                const push = pushAFromB(body, this._bodies[ids[n]]);
                if (!push) {
                    continue;
                }
                overlapping = true;
                const hits = this._countLockedHits(body, body.x + push.x, body.z + push.z);
                const length = Math.hypot(push.x, push.z);
                if (hits < bestHits || (hits === bestHits && length < bestLength)) {
                    bestHits = hits;
                    bestLength = length;
                    bestX = push.x;
                    bestZ = push.z;
                }
            }
            if (!overlapping) {
                return;
            }
            if (bestHits > 0) {
                const behind = this._pushBehindLocked(body);
                if (!behind) {
                    return;
                }
                bestX = behind.x;
                bestZ = behind.z;
            }
            body.x += bestX;
            body.z += bestZ;
        }
    }

    private _countLockedHits(body: Body, x: number, z: number): number {
        const savedX = body.x;
        const savedZ = body.z;
        body.x = x;
        body.z = z;
        let hits = 0;
        const ids = this._lockedIds;
        for (let n = 0; n < ids.length; n++) {
            if (rawGap(body, this._bodies[ids[n]]) < 0) {
                hits++;
            }
        }
        body.x = savedX;
        body.z = savedZ;
        return hits;
    }

    /** Slide straight out of the wall row when a sideways step only enters the next wall. */
    private _pushBehindLocked(body: Body): { x: number; z: number } | null {
        let depth = 0;
        let direction = 0;
        const ids = this._lockedIds;
        for (let n = 0; n < ids.length; n++) {
            const wall = this._bodies[ids[n]];
            if (rawGap(body, wall) >= 0) {
                continue;
            }
            const gapZ = Math.abs(body.z - wall.z) - body.halfZ - wall.halfZ;
            const needed = SKIN - gapZ;
            if (needed > depth) {
                depth = needed;
                direction = body.z <= wall.z ? -1 : 1;
            }
        }
        if (direction === 0) {
            return null;
        }
        return { x: 0, z: direction * depth };
    }

    /** Clears the worst overlap of each object. Locked obstacles win outright. */
    private _polish(project: boolean): void {
        const bodies = this._bodies;
        for (let pass = 0; pass < 16; pass++) {
            this._rebuildHash();
            let moved = false;
            for (let i = 0; i < bodies.length; i++) {
                const a = bodies[i];
                if (a.locked) {
                    continue;
                }
                const near = this._hash.collect(a, SKIN);
                let worstX = 0;
                let worstZ = 0;
                let worstDepth = 0;
                let worstLocked = false;
                for (let n = 0; n < near.length; n++) {
                    const j = near[n];
                    if (j === i) {
                        continue;
                    }
                    const other = bodies[j];
                    const push = pushAFromB(a, other);
                    if (!push) {
                        continue;
                    }
                    const depth = Math.hypot(push.x, push.z);
                    const lockedHit = other.locked;
                    const better = (lockedHit && !worstLocked)
                        || (lockedHit === worstLocked && depth > worstDepth);
                    if (better) {
                        worstDepth = depth;
                        worstX = push.x;
                        worstZ = push.z;
                        worstLocked = lockedHit;
                    }
                }
                if (worstDepth === 0) {
                    continue;
                }
                const share = worstLocked ? 1 : 0.5;
                a.x += worstX * share;
                a.z += worstZ * share;
                if (project) {
                    this._project(a);
                }
                this._ejectFromLocked(a);
                a.position.x = a.x;
                a.position.z = a.z;
                moved = true;
            }
            if (!moved) {
                break;
            }
        }
        this._dirty = true;
    }

    private _prepareShifts(count: number): void {
        if (this._shiftX.length < count) {
            this._shiftX = new Float64Array(count);
            this._shiftZ = new Float64Array(count);
            this._maxStep = new Float64Array(count);
            this._lockedX = new Float64Array(count);
            this._lockedZ = new Float64Array(count);
            this._lockedDepth = new Float64Array(count);
            return;
        }
        this._shiftX.fill(0, 0, count);
        this._shiftZ.fill(0, 0, count);
        this._maxStep.fill(0, 0, count);
        this._lockedX.fill(0, 0, count);
        this._lockedZ.fill(0, 0, count);
        this._lockedDepth.fill(0, 0, count);
    }

    private _project(body: Footprint): void {
        this._clampToField(body.x, body.z, body);
    }

    private _clampToField(x: number, z: number, out: Footprint): void {
        let localX = x - this._center.x;
        let localZ = z - (this._center.z - SCATTER_BEHIND);
        if (localZ > 0) {
            localZ = 0;
        }
        const limit = this._radius;
        const distSq = localX * localX + localZ * localZ;
        if (distSq > limit * limit) {
            const scale = limit / Math.sqrt(distSq);
            localX *= scale;
            localZ *= scale;
            if (localZ > 0) {
                localZ = 0;
                localX = Math.max(-limit, Math.min(limit, localX));
            }
        }
        out.x = this._center.x + localX;
        out.z = this._center.z - SCATTER_BEHIND + localZ;
    }

    private _ensureHash(): void {
        if (this._dirty) {
            this._rebuildHash();
        }
    }

    private _rebuildHash(): void {
        this._hash.clear();
        for (let i = 0; i < this._bodies.length; i++) {
            this._hash.insert(i, this._bodies[i]);
        }
        this._dirty = false;
    }

    private _writeBodies(): void {
        for (let i = 0; i < this._bodies.length; i++) {
            const body = this._bodies[i];
            body.position.x = body.x;
            body.position.z = body.z;
        }
    }

}

/** Resolves overlaps after a radius change without refitting the whole field. */
export function separateOverlaps(
    center: Vec3,
    positions: Vec3[],
    scales: Vec3[],
    shapes: ShapeName[],
    lockedCount: number,
): void {
    const placement = new ObjectPlacement(1, center);
    for (let i = 0; i < positions.length; i++) {
        placement.add(positions[i], scales[i], shapes[i], i < lockedCount);
    }
    placement.relax(false);
}

function rawGap(a: Footprint, b: Footprint): number {
    if (a.round && b.round) {
        return Math.hypot(a.x - b.x, a.z - b.z) - a.halfX - b.halfX;
    }
    if (!a.round && !b.round) {
        const gapX = Math.abs(a.x - b.x) - a.halfX - b.halfX;
        const gapZ = Math.abs(a.z - b.z) - a.halfZ - b.halfZ;
        return Math.max(gapX, gapZ);
    }
    const circle = a.round ? a : b;
    const box = a.round ? b : a;
    return gapCircleBox(circle, box);
}

function gapCircleBox(circle: Footprint, box: Footprint): number {
    const closestX = clamp(circle.x, box.x - box.halfX, box.x + box.halfX);
    const closestZ = clamp(circle.z, box.z - box.halfZ, box.z + box.halfZ);
    const dx = circle.x - closestX;
    const dz = circle.z - closestZ;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-8) {
        return dist - circle.halfX;
    }
    const left = circle.x - (box.x - box.halfX);
    const right = (box.x + box.halfX) - circle.x;
    const down = circle.z - (box.z - box.halfZ);
    const up = (box.z + box.halfZ) - circle.z;
    return -(Math.min(left, right, down, up) + circle.halfX);
}

/** Translation that moves `a` out of `b` until the surfaces are `SKIN` apart. */
function pushAFromB(a: Footprint, b: Footprint): { x: number; z: number } | null {
    const gap = rawGap(a, b);
    if (gap >= 0) {
        return null;
    }
    const depth = SKIN - gap;
    if (a.round && b.round) {
        return pushAlong(a.x - b.x, a.z - b.z, depth);
    }
    if (!a.round && !b.round) {
        const overlapX = a.halfX + b.halfX + SKIN - Math.abs(a.x - b.x);
        const overlapZ = a.halfZ + b.halfZ + SKIN - Math.abs(a.z - b.z);
        if (overlapX < overlapZ) {
            return { x: (Math.sign(a.x - b.x) || 1) * overlapX, z: 0 };
        }
        return { x: 0, z: (Math.sign(a.z - b.z) || 1) * overlapZ };
    }
    if (a.round) {
        return pushCircleFromBox(a, b, depth);
    }
    const opposite = pushCircleFromBox(b, a, depth);
    return { x: -opposite.x, z: -opposite.z };
}

function pushCircleFromBox(circle: Footprint, box: Footprint, depth: number): { x: number; z: number } {
    const closestX = clamp(circle.x, box.x - box.halfX, box.x + box.halfX);
    const closestZ = clamp(circle.z, box.z - box.halfZ, box.z + box.halfZ);
    const dx = circle.x - closestX;
    const dz = circle.z - closestZ;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-8) {
        const scale = depth / dist;
        return { x: dx * scale, z: dz * scale };
    }
    const left = circle.x - (box.x - box.halfX);
    const right = (box.x + box.halfX) - circle.x;
    const down = circle.z - (box.z - box.halfZ);
    const up = (box.z + box.halfZ) - circle.z;
    const min = Math.min(left, right, down, up);
    if (min === left) {
        return { x: -depth, z: 0 };
    }
    if (min === right) {
        return { x: depth, z: 0 };
    }
    if (min === down) {
        return { x: 0, z: -depth };
    }
    return { x: 0, z: depth };
}

function pushAlong(x: number, z: number, depth: number): { x: number; z: number } {
    const dist = Math.hypot(x, z);
    if (dist < 1e-8) {
        return { x: depth, z: 0 };
    }
    const scale = depth / dist;
    return { x: x * scale, z: z * scale };
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

class FootprintHash {

    private readonly _map = new Map<number, number[]>();
    private _stamp = new Int32Array(32);
    private _stampId = 1;
    private readonly _near: number[] = [];

    public clear(): void {
        this._map.clear();
    }

    public insert(index: number, body: Footprint): void {
        const minX = Math.floor((body.x - body.halfX) / HASH_CELL);
        const maxX = Math.floor((body.x + body.halfX) / HASH_CELL);
        const minZ = Math.floor((body.z - body.halfZ) / HASH_CELL);
        const maxZ = Math.floor((body.z + body.halfZ) / HASH_CELL);
        for (let z = minZ; z <= maxZ; z++) {
            for (let x = minX; x <= maxX; x++) {
                const key = (x + 4096) + (z + 4096) * 8192;
                let bucket = this._map.get(key);
                if (!bucket) {
                    bucket = [];
                    this._map.set(key, bucket);
                }
                bucket.push(index);
            }
        }
    }

    public collect(body: Footprint, margin: number): number[] {
        this._stampId++;
        if (this._stampId === 0x7fffffff) {
            this._stamp.fill(0);
            this._stampId = 1;
        }
        const near = this._near;
        near.length = 0;
        const minX = Math.floor((body.x - body.halfX - margin) / HASH_CELL);
        const maxX = Math.floor((body.x + body.halfX + margin) / HASH_CELL);
        const minZ = Math.floor((body.z - body.halfZ - margin) / HASH_CELL);
        const maxZ = Math.floor((body.z + body.halfZ + margin) / HASH_CELL);
        for (let z = minZ; z <= maxZ; z++) {
            for (let x = minX; x <= maxX; x++) {
                const bucket = this._map.get((x + 4096) + (z + 4096) * 8192);
                if (!bucket) {
                    continue;
                }
                for (let i = 0; i < bucket.length; i++) {
                    const index = bucket[i];
                    if (index >= this._stamp.length) {
                        const grown = new Int32Array(Math.max(index + 1, this._stamp.length * 2));
                        grown.set(this._stamp);
                        this._stamp = grown;
                    }
                    if (this._stamp[index] === this._stampId) {
                        continue;
                    }
                    this._stamp[index] = this._stampId;
                    near.push(index);
                }
            }
        }
        return near;
    }

}
