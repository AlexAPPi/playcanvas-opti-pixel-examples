import { Vec3 } from 'playcanvas';

export type ShapeName = 'box' | 'sphere' | 'cylinder';

const WALL_CAP = 16;
const SCATTER_SHAPES: ShapeName[] = ['box', 'sphere', 'cylinder'];

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

export function layoutScatter(radius: number, center: Vec3, position: Vec3, scale: Vec3): void {
    const distance = Math.random() * radius;
    const yaw = Math.random() * Math.PI * 2;
    const height = 0.6 + Math.random() * Math.min(radius * 0.35, 18);
    position.set(
        center.x + Math.cos(yaw) * distance,
        height * 0.5,
        center.z - 6 - Math.abs(Math.sin(yaw)) * distance,
    );
    const size = 0.6 + Math.random() * 2.4;
    scale.set(size, height, size);
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
