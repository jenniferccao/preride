<p align="center">
<img width="80%" alt="preride_cover" src="https://github.com/user-attachments/assets/94704157-7bc1-491e-83a4-92a01a2af1b6" />

  
Have you ever ridden a hill in a headwind and wished you knew ahead of time to properly plan your energy? PreRide is a simple web app that visualizes the relative difficulty of a route based on wind effect and elevation.

## Try it out!
https://preride.vercel.app/

## Features

- Load and display GPX routes with start/finish markers
- Per‑point wind arrows fetched from Open‑Meteo
- 3D terrain view toggle
- Upload custom routes
- Time slider to animate wind data


<p align="center">
<img width="80%" alt="Screenshot 2026-02-19 at 9 32 45 PM" src="https://github.com/user-attachments/assets/594c779c-8c8f-4717-840b-991490dc81fb" />
<img width="80%" alt="Screenshot 2026-02-19 at 10 15 52 PM" src="https://github.com/user-attachments/assets/fde5dd20-0521-431b-b891-510a2caa0580" />



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
