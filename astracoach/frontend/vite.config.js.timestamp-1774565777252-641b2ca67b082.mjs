// vite.config.js
import { defineConfig } from "file:///sessions/wizardly-funny-bohr/mnt/update_name/astracoach/frontend/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/wizardly-funny-bohr/mnt/update_name/astracoach/frontend/node_modules/@vitejs/plugin-react/dist/index.js";
var vite_config_default = defineConfig({
  plugins: [react()],
  // Read .env from the project root (astracoach/) so frontend and backend
  // share a single .env file. Without this Vite only looks in frontend/
  // and misses VITE_SIMLI_API_KEY and other VITE_ vars.
  envDir: "..",
  // Force Vite/esbuild to pre-bundle simli-client as CJS.
  // simli-client@3.x has no ESM export ("type":"module" is absent, no "exports" field),
  // so without this Vite may fail to resolve named exports and receive `undefined`.
  optimizeDeps: {
    include: ["simli-client"]
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/health": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvd2l6YXJkbHktZnVubnktYm9oci9tbnQvdXBkYXRlX25hbWUvYXN0cmFjb2FjaC9mcm9udGVuZFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3Nlc3Npb25zL3dpemFyZGx5LWZ1bm55LWJvaHIvbW50L3VwZGF0ZV9uYW1lL2FzdHJhY29hY2gvZnJvbnRlbmQvdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Nlc3Npb25zL3dpemFyZGx5LWZ1bm55LWJvaHIvbW50L3VwZGF0ZV9uYW1lL2FzdHJhY29hY2gvZnJvbnRlbmQvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIC8vIFJlYWQgLmVudiBmcm9tIHRoZSBwcm9qZWN0IHJvb3QgKGFzdHJhY29hY2gvKSBzbyBmcm9udGVuZCBhbmQgYmFja2VuZFxuICAvLyBzaGFyZSBhIHNpbmdsZSAuZW52IGZpbGUuIFdpdGhvdXQgdGhpcyBWaXRlIG9ubHkgbG9va3MgaW4gZnJvbnRlbmQvXG4gIC8vIGFuZCBtaXNzZXMgVklURV9TSU1MSV9BUElfS0VZIGFuZCBvdGhlciBWSVRFXyB2YXJzLlxuICBlbnZEaXI6ICcuLicsXG4gIC8vIEZvcmNlIFZpdGUvZXNidWlsZCB0byBwcmUtYnVuZGxlIHNpbWxpLWNsaWVudCBhcyBDSlMuXG4gIC8vIHNpbWxpLWNsaWVudEAzLnggaGFzIG5vIEVTTSBleHBvcnQgKFwidHlwZVwiOlwibW9kdWxlXCIgaXMgYWJzZW50LCBubyBcImV4cG9ydHNcIiBmaWVsZCksXG4gIC8vIHNvIHdpdGhvdXQgdGhpcyBWaXRlIG1heSBmYWlsIHRvIHJlc29sdmUgbmFtZWQgZXhwb3J0cyBhbmQgcmVjZWl2ZSBgdW5kZWZpbmVkYC5cbiAgb3B0aW1pemVEZXBzOiB7XG4gICAgaW5jbHVkZTogWydzaW1saS1jbGllbnQnXSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogNTE3MyxcbiAgICBwcm94eToge1xuICAgICAgJy9hcGknOiB7IHRhcmdldDogJ2h0dHA6Ly9sb2NhbGhvc3Q6ODAwMCcsIGNoYW5nZU9yaWdpbjogdHJ1ZSB9LFxuICAgICAgJy9oZWFsdGgnOiB7IHRhcmdldDogJ2h0dHA6Ly9sb2NhbGhvc3Q6ODAwMCcsIGNoYW5nZU9yaWdpbjogdHJ1ZSB9LFxuICAgICAgJy93cyc6IHsgdGFyZ2V0OiAnd3M6Ly9sb2NhbGhvc3Q6ODAwMCcsIHdzOiB0cnVlIH0sXG4gICAgfSxcbiAgfSxcbn0pXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXFYLFNBQVMsb0JBQW9CO0FBQ2xaLE9BQU8sV0FBVztBQUVsQixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFJakIsUUFBUTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBSVIsY0FBYztBQUFBLElBQ1osU0FBUyxDQUFDLGNBQWM7QUFBQSxFQUMxQjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLE1BQ0wsUUFBUSxFQUFFLFFBQVEseUJBQXlCLGNBQWMsS0FBSztBQUFBLE1BQzlELFdBQVcsRUFBRSxRQUFRLHlCQUF5QixjQUFjLEtBQUs7QUFBQSxNQUNqRSxPQUFPLEVBQUUsUUFBUSx1QkFBdUIsSUFBSSxLQUFLO0FBQUEsSUFDbkQ7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
