import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Vertex shader - displaces vertices based on heightmap
const vertexShader = `
    uniform sampler2D heightMap;
    uniform float elevationScale;
    uniform vec2 uvOffset;
    
    varying vec2 vUv;
    varying vec2 vRawUv;
    varying float vElevation;
    
    void main() {
        vRawUv = uv;
        vec2 scrolledUv = fract(uv + uvOffset);
        vUv = scrolledUv;
        
        // Sample heightmap
        float height = texture2D(heightMap, scrolledUv).r;
        vElevation = height;
        
        // Displace vertex along Y axis
        vec3 newPosition = position;
        newPosition.y = height * elevationScale;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
    }
`;

// Fragment shader - draws contour lines
const fragmentShader = `
    uniform float contourCount;
    uniform float lineThickness;
    uniform vec3 lineColor;
    uniform vec3 lineLowColor;
    uniform vec3 lineHighColor;
    uniform vec3 backgroundColor;
    uniform float time;
    
    varying vec2 vUv;
    varying vec2 vRawUv;
    varying float vElevation;
    
    void main() {
        vec2 centered = vRawUv - 0.5;
        if (length(centered) > 0.5) discard;

        // Create contour lines using fract and fwidth for smooth anti-aliased lines
        float scaledHeight = vElevation * contourCount;
        
        // Distance to nearest contour line
        float contourDist = abs(fract(scaledHeight) - 0.5);
        
        // Use fwidth for screen-space anti-aliasing
        float fw = fwidth(scaledHeight) * lineThickness;
        
        // Smooth line
        float line = 1.0 - smoothstep(0.0, fw, contourDist);
        
        // Add thicker lines every 5 contours (major contours)
        float majorScaledHeight = vElevation * (contourCount / 5.0);
        float majorContourDist = abs(fract(majorScaledHeight) - 0.5);
        float majorFw = fwidth(majorScaledHeight) * lineThickness * 1.5;
        float majorLine = 1.0 - smoothstep(0.0, majorFw, majorContourDist);
        
        // Combine lines with major lines being brighter
        float combinedLine = max(line * 0.6, majorLine);
        
        // Color based on elevation for subtle variation
        vec3 dynamicLineColor = mix(lineLowColor, lineHighColor, vElevation);
        
        // Subtle pulse on major contours
        float pulse = sin(time * 2.0 - vElevation * 10.0) * 0.1 + 0.9;
        
        // Final color
        vec3 finalColor = mix(backgroundColor, dynamicLineColor * pulse, combinedLine);
        
        // Add subtle elevation-based ambient
        finalColor += vec3(0.02, 0.05, 0.1) * vElevation * 0.5;
        
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

class TopoTerrain {
    constructor() {
        this.params = {
            contourCount: 80,
            lineThickness: 1,
            elevationScale: 0.93,
            glowIntensity: 0.54,
            scrollSpeed: 0.055,
            lineLowColor: '#ff2080',
            lineHighColor: '#00ff40',
            crtBarrel: 0.019,
            crtChromatic: 0.0069,
            crtScanline: 0.17,
            crtVignette: 1.44,
            crtFlicker: 0.034,
            crtBandSpeed: 0.103,
            exposure: 1.46,
            contrast: 1.32,
            whiteBalance: 0.0,
            tileSize: 162,
            tileBlend: 'overlay',
            tileOpacity: 0.52,
            tileContrast: 1.97
        };
        
        this.init();
        this.loadHeightmap();
        this.setupTileOverlay();
        this.setupControls();
        this.animate();
    }
    
    init() {
        this.canvasContainer = document.querySelector('.canvas-container');

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x05080f);
        
        // Camera
        const cw = this.canvasContainer.clientWidth;
        const ch = this.canvasContainer.clientHeight;
        this.camera = new THREE.PerspectiveCamera(
            45,
            cw / ch,
            0.1,
            100
        );
        this.camera.position.set(2, 2, 2);
        this.camera.lookAt(0, 0, 0);
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById('canvas'),
            antialias: true
        });
        this.renderer.setSize(cw, ch);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        // Orbit controls
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.orbitControls.minDistance = 1;
        this.orbitControls.maxDistance = 8;
        this.orbitControls.maxPolarAngle = Math.PI / 2.1;
        
        // Post-processing
        this.composer = new EffectComposer(this.renderer);
        this.renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(this.renderPass);
        
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(cw, ch),
            this.params.glowIntensity,  // Intensity
            0.4,   // Radius
            0.3    // Threshold
        );
        this.composer.addPass(this.bloomPass);
        
        // CRT shader pass
        this.crtUniforms = {
            tDiffuse:   { value: null },
            uTime:      { value: 0 },
            uRes:       { value: new THREE.Vector2(cw, ch) },
            uBarrel:    { value: this.params.crtBarrel },
            uCA:        { value: this.params.crtChromatic },
            uScanline:  { value: this.params.crtScanline },
            uVignette:  { value: this.params.crtVignette },
            uFlicker:   { value: this.params.crtFlicker },
            uBandSpeed: { value: this.params.crtBandSpeed },
            uExposure:  { value: this.params.exposure },
            uContrast:  { value: this.params.contrast },
            uWhiteBalance: { value: this.params.whiteBalance }
        };
        const crtPass = new ShaderPass({
            uniforms: this.crtUniforms,
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform float uTime, uBarrel, uCA, uScanline, uVignette, uFlicker, uBandSpeed, uExposure, uContrast, uWhiteBalance;
                uniform vec2  uRes;
                varying vec2  vUv;

                void main() {
                    vec2 uv = vUv;
                    vec2 c  = uv - 0.5;
                    float d2 = dot(c, c);

                    uv += c * d2 * uBarrel;

                    float ca = uCA + d2 * uCA * 2.5;
                    vec3 col = vec3(
                        texture2D(tDiffuse, uv + vec2(ca, 0.0)).r,
                        texture2D(tDiffuse, uv).g,
                        texture2D(tDiffuse, uv - vec2(ca, 0.0)).b
                    );

                    col -= sin(uv.y * uRes.y * 0.85) * uScanline;

                    col += smoothstep(0.016, 0.0, abs(fract(uv.y - uTime * uBandSpeed) - 0.5))
                           * vec3(0.1, 0.32, 0.8) * 0.1;

                    col *= 1.0 - d2 * uVignette;
                    col *= (1.0 - uFlicker) + uFlicker * (sin(uTime * 48.0) * 0.5 + 0.5);

                    col *= uExposure;
                    col = (col - 0.5) * uContrast + 0.5;
                    col.r += uWhiteBalance * 0.1;
                    col.b -= uWhiteBalance * 0.1;

                    gl_FragColor = vec4(col, 1.0);
                }
            `
        });
        this.composer.addPass(crtPass);
        this.crtUniforms = crtPass.uniforms;
        
        // Handle resize
        new ResizeObserver(() => this.onResize()).observe(this.canvasContainer);
        
        // Clock for animations
        this.clock = new THREE.Clock();
    }
    
    loadHeightmap() {
        const textureLoader = new THREE.TextureLoader();
        
        textureLoader.load('heightmap_512x512.png', (texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            
            this.createTerrain(texture);
        });
    }
    
    createTerrain(heightMapTexture) {
        // High-resolution plane for smooth contours
        const geometry = new THREE.PlaneGeometry(2, 2, 512, 512);
        geometry.rotateX(-Math.PI / 2);
        
        // Shader material
        this.material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                heightMap: { value: heightMapTexture },
                contourCount: { value: this.params.contourCount },
                lineThickness: { value: this.params.lineThickness },
                elevationScale: { value: this.params.elevationScale },
                lineColor: { value: new THREE.Color(0x4a9eff) },
                lineLowColor: { value: new THREE.Color(this.params.lineLowColor) },
                lineHighColor: { value: new THREE.Color(this.params.lineHighColor) },
                backgroundColor: { value: new THREE.Color(0x05080f) },
                time: { value: 0 },
                uvOffset: { value: new THREE.Vector2(0, 0) }
            },
            side: THREE.DoubleSide
        });
        
        this.terrain = new THREE.Mesh(geometry, this.material);
        this.scene.add(this.terrain);
    }
    
    setupTileOverlay() {
        this.tileOverlay = document.getElementById('tile-overlay');
        const p = this.params;
        this.tileOverlay.style.backgroundSize = `${p.tileSize}px ${p.tileSize}px`;
        this.tileOverlay.style.mixBlendMode = p.tileBlend;
        this.tileOverlay.style.opacity = p.tileOpacity;
        this.tileOverlay.style.filter = `contrast(${p.tileContrast})`;
    }

    setTileImage(src) {
        this.tileOverlay.style.backgroundImage = `url('${src}')`;
    }

    setupControls() {
        /* globals SHPanel */
        const panel = new SHPanel(document.getElementById('control-panel'));
        const p = this.params;

        const terrain = panel.folder('Terrain');
        terrain.slider(p, 'contourCount', { min: 5, max: 80, step: 1 })
            .on('change', (e) => {
                if (this.material) this.material.uniforms.contourCount.value = e.value;
            });
        terrain.slider(p, 'lineThickness', { min: 1, max: 20, step: 1 })
            .on('change', (e) => {
                if (this.material) this.material.uniforms.lineThickness.value = e.value;
            });
        terrain.slider(p, 'elevationScale', { min: 0, max: 1, step: 0.01 })
            .on('change', (e) => {
                if (this.material) this.material.uniforms.elevationScale.value = e.value;
            });
        terrain.color(p, 'lineLowColor').on('change', (e) => {
            if (this.material) this.material.uniforms.lineLowColor.value.set(e.value);
        });
        terrain.color(p, 'lineHighColor').on('change', (e) => {
            if (this.material) this.material.uniforms.lineHighColor.value.set(e.value);
        });

        const display = panel.folder('Display');
        display.slider(p, 'glowIntensity', { min: 0, max: 3, step: 0.01 })
            .on('change', (e) => { this.bloomPass.strength = e.value; });
        display.slider(p, 'scrollSpeed', { min: 0, max: 0.1, step: 0.001 });
        display.slider(p, 'exposure', { min: 0, max: 2, step: 0.01 });
        display.slider(p, 'contrast', { min: 0, max: 3, step: 0.01 });
        display.slider(p, 'whiteBalance', { min: -1, max: 1, step: 0.01 });

        const crt = panel.folder('CRT');
        crt.slider(p, 'crtBarrel', { min: 0, max: 0.12, step: 0.001 })
            .on('change', (e) => { this.crtUniforms.uBarrel.value = e.value; });
        crt.slider(p, 'crtChromatic', { min: 0, max: 0.01, step: 0.0001 })
            .on('change', (e) => { this.crtUniforms.uCA.value = e.value; });
        crt.slider(p, 'crtScanline', { min: 0, max: 1, step: 0.01 })
            .on('change', (e) => { this.crtUniforms.uScanline.value = e.value; });
        crt.slider(p, 'crtVignette', { min: 0, max: 3, step: 0.01 })
            .on('change', (e) => { this.crtUniforms.uVignette.value = e.value; });

        const tile = panel.folder('Tile Overlay');
        tile.file({ accept: 'image/*', label: 'Upload tile' }).on('change', (e) => {
            if (e.file) {
                const url = URL.createObjectURL(e.file);
                this.setTileImage(url);
            }
        });
        tile.slider(p, 'tileSize', { min: 16, max: 512, step: 1, label: 'Tile size' })
            .on('change', (e) => {
                this.tileOverlay.style.backgroundSize = `${e.value}px ${e.value}px`;
            });
        tile.select(p, 'tileBlend', {
            label: 'Blend mode',
            options: ['screen', 'overlay', 'multiply', 'color-dodge', 'color-burn', 'soft-light', 'hard-light', 'difference', 'exclusion', 'luminosity']
        }).on('change', (e) => {
            this.tileOverlay.style.mixBlendMode = e.value;
        });
        tile.slider(p, 'tileOpacity', { min: 0, max: 1, step: 0.01, label: 'Opacity' })
            .on('change', (e) => {
                this.tileOverlay.style.opacity = e.value;
            });
        tile.slider(p, 'tileContrast', { min: 0, max: 5, step: 0.01, label: 'Contrast' })
            .on('change', (e) => {
                this.tileOverlay.style.filter = `contrast(${e.value})`;
            });
    }
    
    onResize() {
        const w = this.canvasContainer.clientWidth;
        const h = this.canvasContainer.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        this.composer.setSize(w, h);
        this.bloomPass.resolution.set(w, h);
        this.crtUniforms.uRes.value.set(w, h);
    }
    
    animate() {
        requestAnimationFrame(() => this.animate());
        
        const elapsed = this.clock.getElapsedTime();
        
        // Update time uniform and scroll offset
        if (this.material) {
            const speed = this.params.scrollSpeed;
            this.material.uniforms.uvOffset.value.set(elapsed * speed, elapsed * speed * 0.7);
            this.material.uniforms.time.value = elapsed;
        }
        
        // Update CRT uniforms
        this.crtUniforms.uTime.value = elapsed;
        this.crtUniforms.uExposure.value = this.params.exposure;
        this.crtUniforms.uContrast.value = this.params.contrast;
        this.crtUniforms.uWhiteBalance.value = this.params.whiteBalance;
        
        this.orbitControls.update();
        this.composer.render();
    }
}

// Initialize
new TopoTerrain();
