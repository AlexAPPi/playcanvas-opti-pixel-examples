import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const librarySrc = path.resolve(repoRoot, '../playcanvas-opti-pixel/src');

export default defineConfig({
    resolve: {
        alias: {
            'playcanvas-opti-pixel': librarySrc,
        },
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
