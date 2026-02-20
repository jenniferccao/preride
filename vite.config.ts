import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Treat .geojson files as JSON modules (Vite's built-in JSON transform only covers .json)
function geojsonPlugin(): Plugin {
  return {
    name: 'vite-plugin-geojson',
    transform(code, id) {
      if (!id.endsWith('.geojson')) return null;
      return {
        code: `export default ${code}`,
        map: null,
      };
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), geojsonPlugin()],
})

