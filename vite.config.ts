import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const librarySrc = path.resolve(repoRoot, '../playcanvas-opti-pixel/src');
const playcanvasPkg = path.resolve(repoRoot, 'node_modules/playcanvas');

export default defineConfig({
    // Relative asset URLs so the build opens from a GitHub Pages project site.
    base: './',
    resolve: {
        alias: [
            { find: 'playcanvas-opti-pixel', replacement: librarySrc },
            // The library lives outside this package and has its own playcanvas.
            // ShaderUtils reads a per-module program-library cache, so a second
            // copy never sees the library registered by AppBase.
            { find: /^playcanvas$/, replacement: playcanvasPkg },
        ],
        dedupe: ['playcanvas'],
    },
    optimizeDeps: {
        exclude: ['playcanvas-opti-pixel'],
    },
    server: {
        // Node resolves "localhost" to ::1 first. On this machine connect() to ::1
        // fails with EACCES, so the dev server must bind the IPv4 loopback.
        host: '127.0.0.1',
        allowedHosts: true,
        fs: {
            allow: [repoRoot, librarySrc],
        },
    },
    preview: {
        host: '127.0.0.1',
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true,
    },
});
