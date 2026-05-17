import { defineConfig } from "vite";

export default defineConfig({
    server: {
        proxy: {
            "/socket.io": {
                target: "http://localhost:3000",
                ws: true,
            },
        },
    },
    build: {
        outDir: "dist",
    },
});
