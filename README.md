# OptiPixel – occlusion culling example

A PlayCanvas Engine demo for the `playcanvas-opti-pixel` library. This project requires the library installed locally in the sibling folder `playcanvas-opti-pixel`. The page shows a flying camera, an occluder wall, and a scatter of objects. Objects hidden behind the wall are rejected by one of the occlusion tests; the stats line shows how many of them remain in frame.

HZB, Coverage, and Queries are supported on WebGL2, and indirect draw and Coverage on WebGPU. The interface is in Russian and English: the language comes from the browser, and the switch in the panel header lasts until reload.

---

## Running

Install the `playcanvas-opti-pixel` library locally in the sibling folder `playcanvas-opti-pixel`, next to this repository. The folder name has to be exact: `package.json` depends on it with `file:../playcanvas-opti-pixel`, and Vite loads `../playcanvas-opti-pixel/src`. The library source imports `playcanvas` from that folder’s own `node_modules`, so install the library there before installing this project.

```text
playcanvas-opti-pixel/            ← library, install here first
playcanvas-opti-pixel-examples/   ← this repository
```

From this repository:

```bash
cd ../playcanvas-opti-pixel
npm install
cd ../playcanvas-opti-pixel-examples
npm install
npm run dev
```

The terminal prints the page address, usually `http://127.0.0.1:5173/`. Build a static page with `npm run build` (output in `dist`). Preview an existing build with `npm run preview`. `npm run srv` rebuilds and hosts `dist` at `http://127.0.0.1:4173/`.

The Device item reloads the page. Auto and WebGPU request WebGPU and fall back to WebGL2 if it fails to start. Explicit WebGL2 creates WebGL2 only. The choice is written to the query parameter `?device=webgpu` or `?device=webgl2`.

If the scene fails to start, a red error appears at the bottom of the panel, and the stats line shows “Failed to start the scene”.

---

## Scene

The camera sits at `(0, 8, 36)` and looks at the center of the wall. Field of view is 60°, near is `0.05`, far is `1000`. A ground plane lies under the objects. Lighting is a single directional light, with no shadows. The frame counter is in the top-right corner.

Objects are split into two groups:

- **Wall.** Up to 16 boxes in a row in front of the camera. These are the occluders: the other objects hide behind them.
- **Scatter.** Cubes, spheres, and cylinders behind the wall, within the radius. Colors alternate.

The defaults are 30 objects and a radius of 48. Count ranges from 1 to 2000: extra objects are removed, and new ones extend the wall and the scatter. Radius ranges from 8 to 120. The wall is laid out again, and the scatter is scaled around the center, so relative placement is kept.

While the test is off, objects are culled only by the camera frustum.

---

## Panel

The panel is on the left. Item hints are in the `title` tooltip.

### Mode

| Item | What it does |
| --- | --- |
| Device | Auto, WebGPU, or WebGL2. Changing it reloads the page. |
| Test | Coverage (default), HZB, Queries, or off. An item unavailable on this device is disabled. |
| HZB render | How WebGPU builds the pyramid: Compute or Pixel. On WebGL2 the pyramid is always built by its own pixel path, and the item is unavailable. |
| Depth | Where the pyramid takes scene depth from. |
| Encoding | How CameraFrame writes `sceneDepthMap`. The item has no effect on a depth grab. |

Under the blocks, the panel states which backend is running: device, mode, pyramid, and depth source.

### Object controls

Count and Radius are described in the Scene section.

### CoverageBuffer

This block belongs to Coverage mode. The map cap is set in texels; the downloaded size is less than or equal to the cap and is shown in the stats.

| Item | Default | Meaning |
| --- | --- | --- |
| Buffer width | 256 | Width cap, 1–1024. |
| Buffer height | 128 | Height cap, 1–1024. |
| minReadbackLag | 2 | How many `frameUpdate` calls to wait before copying a finished download to the CPU. 0 means as soon as it is ready. |
| readbackSlots | 5 | How many GPU→CPU reads to keep in flight. Minimum 2. Changing it drops downloads that have not arrived yet. |
| readbackPeriod | 1 | WebGL only. Pack the map every Nth visit while a slot is free. Gathering still runs every frame. On WebGPU the item is hidden: packing runs when a slot is free. |
| cpuReadback | on | When off, capture does not pack the map and does not start a read. A read already in progress is still published. |

### Debug

| Item | Meaning |
| --- | --- |
| Auto update | On by default. When off, the occlusion test stops updating and keeps the last visibility result. |
| Show buffer | The HZB pyramid, or the two Coverage maps: the downloaded one and the current-frame reprojection. |
| Object debug | Turns on inspection of a single object. Its index appears in the stats. |
| Mip fullscreen | The selected HZB mip, or the Coverage map, across the whole frame. |
| Map | What to draw fullscreen in Coverage: the current-frame reprojection or the downloaded buffer. |
| Mip level | Pyramid mip, 0–20. |
| Mip opacity | Opacity of the debug draw. 1 is solid, 0 is transparent. |

The `C` key toggles object debug. `+` and `-` (including the numeric keypad) move to the neighbor. `B` toggles the AABB box, `R` toggles the screen frame. On a phone, the same neighboring objects are selected with the `+` and `−` buttons.

For Queries, the debug box is green when the object is visible and red when it is occluded. For HZB and Coverage, the box and frame are drawn by that test’s debugger.

---

## Camera controls

**Mouse and keyboard.** Right mouse button looks around, middle button pans in the screen plane. WASD or the arrow keys move. Normal speed is 20, Shift is 60, Space is 4. The right-click context menu is disabled.

**Touch screen.** The left stick moves, the right stick looks around. The farther the move stick is from the center, the closer the speed is to the fast speed. The `+` and `−` buttons step through the debug object. On a coarse pointer, text selection on the page is disabled so a gesture does not select the panel.

---

## Culling modes

### WebGL2

- **HZB (Hierarchical Z-Buffer).** The pyramid is built by a pixel pass, and a mip is no larger than 512. Visibility is returned to the CPU through transform feedback, a few frames later.
- **Coverage.** Packs one mip of the already built HZB pyramid into a view-space Z map, downloads it, and tests AABBs in a worker. The result is `getOcclusionStatus` on the CPU, also a few frames later. Indirect draw is not used.
- **Queries.** Hardware occlusion queries. Each box is drawn with a query after the opaque pass of the `World` layer, and the result is read on a later frame.

### WebGPU

- **HZB / indirect draw.** The pyramid is built by a compute shader or a pixel pass: the HZB render item. The test writes the indirect-draw count, and occluded meshes do not enter the pipeline. The device’s indirect-draw cap is 2048.
- **Coverage.** The same CPU test as on WebGL2: a pyramid mip is packed by a compute pass and read through staging buffers. Indirect draw is not used.

The pyramid is required for both HZB and Coverage. It is not built in Queries mode or when the test is off.

### Depth source

HZB reads either the camera depth grab or `camera.sceneDepthMap`, which CameraFrame publishes. Coverage does not read depth itself: it takes the pyramid that has already been built. While the camera has `framePasses` set, `requestSceneDepthMap` does not create a depth capture. The source is switched by the Depth item, and the encoding by the Encoding item.

A depth grab is always device Z. CameraFrame has three encodings: `linear` (meters in R32F, depth prepass), `packed` (the same meters in RGBA8), and `reciprocal` (`1 / viewZ`, scene texture). Reciprocal is enabled through TAA with zero jitter, without blurring the frame by shifting the projection. If a float render target is unavailable, the prepass writes packed on its own, and linear cannot be selected.

---

## Stats line

Format: `device · mode · buffer · depth · in frame N / M`.

- **Buffer** `width×height` appears in Coverage and shows the downloaded map size.
- **Read** stays up while the first packed map has not yet reached the CPU.
- **Object N** is the index of the object opened in debug.

`N` is how many objects were actually drawn, `M` is how many are in the scene. An object behind the wall and outside the frustum is not included in `N`. For Coverage and WebGL2 HZB, visibility arrives a few frames later, so the counter lags the camera slightly.

---

## How to experiment

1. Stand the camera in front of the wall and compare “in frame” for Coverage, HZB, Queries, and Off. With the test off, objects remain behind the wall that the test should remove.
2. Raise the count into the hundreds and thousands and watch frames per second on WebGPU and WebGL2.
3. On WebGPU, switch HZB render between Compute and Pixel and turn on Show buffer.
4. Change Depth and the CameraFrame encoding. Linear disappears from the list if a float render target is unavailable.
5. In Coverage, shrink the buffer, raise `minReadbackLag`, and turn off `cpuReadback`. While the first read is in progress, the stats show “read”.
6. Turn on object debug, step with `+`/`-`, and compare the box with whether the object stayed in frame. Mip fullscreen shows the selected pyramid level or the Coverage map.

---

## Further work

- Add culling through **occlusion queries** on WebGPU.
- Optimize buffers and reduce overhead for mobile devices.
- Support automatic adjustment of occlusion parameters based on GPU performance.

---

## License

This repository is distributed under the `MIT` license (see the `LICENSE` file).
