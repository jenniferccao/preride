# PreRide

Have you ever ridden a hill in a headwind and wished you knew ahead of time to properly plab your energy? PreRide is a web app that visualizesthe relative difficulty of a route based on wind effect and elevation.

## Features

- Load and display GPX routes with start/finish markers
- Per‑point wind arrows fetched from Open‑Meteo
- 3D terrain view toggle
- Upload custom routes
- Time slider to animate wind data

## Setup

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create `.env.local` from `.env.example` and set `VITE_MAPBOX_TOKEN`.

## Running

Start the development server:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).
