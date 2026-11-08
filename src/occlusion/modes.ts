export const TesterMode = {
    None: 0,
    Coverage: 1,
    HZB: 2,
    Queries: 3,
} as const;

export type TesterMode = typeof TesterMode[keyof typeof TesterMode];

/** How the WebGPU HZB pyramid is built. WebGL always uses its own pixel path. */
export const HzbRenderer = {
    Compute: 'compute',
    Pixel: 'pixel',
} as const;

export type HzbRenderer = typeof HzbRenderer[keyof typeof HzbRenderer];

/** Where the HZB pyramid reads scene depth. */
export const DepthSource = {
    DepthGrab: 'grab',
    CameraFrame: 'camera-frame',
} as const;

export type DepthSource = typeof DepthSource[keyof typeof DepthSource];

/**
 * Encoding of `camera.sceneDepthMap` when the source is CameraFrame.
 * Depth grab is always device Z and ignores this.
 */
export const DepthEncoding = {
    /** View-space metres in R32F. CameraFrame depth prepass. */
    Linear: 'linear',
    /** View-space metres in RGBA8. CameraFrame writes this when a float render target is unavailable. */
    Packed: 'packed',
    /** `1 / viewZ`. CameraFrame scene-texture depth, requested via TAA with zero jitter. */
    Reciprocal: 'reciprocal',
} as const;

export type DepthEncoding = typeof DepthEncoding[keyof typeof DepthEncoding];
