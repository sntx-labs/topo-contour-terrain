# Topographic Terrain Visualization

A WebGL-based topographic map visualization using Three.js with smooth contour lines rendered via custom shaders.

## Features

- **Smooth contour lines** - Shader-based isolines that follow elevation naturally
- **Major/minor contours** - Thicker lines every 5th contour for better readability
- **3D displacement** - Heightmap drives actual vertex displacement for depth
- **Bloom post-processing** - Glowing lines for that cyberpunk aesthetic
- **Interactive controls** - Orbit, zoom, and parameter adjustment

## Controls

- **Drag** - Rotate camera
- **Scroll** - Zoom in/out
- **Sliders** - Adjust contour count, line thickness, elevation, and glow

## Running

Serve the folder with any static server:

```bash
npx serve .
# or
python -m http.server 8000
```

Then open `http://localhost:3000` (or 8000 for Python).

## Customization

Replace `heightmap_512x512.png` with your own heightmap (grayscale, any resolution).
