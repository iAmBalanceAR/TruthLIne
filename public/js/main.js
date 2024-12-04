console.log('main.js loaded - starting initialization');

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const debug = document.getElementById('debug');
function log(message) {
    console.log(message);
    if (debug) {
        debug.innerHTML += message + '<br>';
    }
}

let scene, camera, renderer, controls;
let combinedLine = null;
let glowLine = null;
let storedPrediction = null;
let currentPathIndex = 0;
let allPoints = [];
let lineColors = [];
const pathPoints = [];
let isAnimating = false;
let animationProgress = 0;
const ANIMATION_SPEED = 0.7;
const SEGMENT_DURATION = 300;
let predictionPoints = [];
let predictionAnimationProgress = 0;
let isPredictionAnimating = false;
let predictionLine = null;
let isCloudVisible = true;
let tokenCloud = null;
let isPathsExtracted = false;
let originalPathPosition = new THREE.Vector3();
let extractedPosition = new THREE.Vector3(0, 0, -15);

const PATH_CONSTANTS = {
    ENERGY_THRESHOLD: 0.7,
    FOLD_INFLUENCE: 0.4,
    MIN_SEPARATION: 0.3,
    PREDICTION_START_POINT: 9
};

// Add these camera positions near the top with other constants
const CAMERA_POSITIONS = {
    front: { x: 0, y: 0, z: 10 },
    top: { x: 0, y: 10, z: 0 },
    side: { x: 10, y: 0, z: 0 },
    angle: { x: 6, y: 6, z: 6 }
};

// Add at the top with other state variables
const MAX_LINES = 3;  // How many lines we want to run concurrently
let lineCount = 0;
const lineSets = [];  // Array to store our line sets

// Add to state variables
const DEFAULT_SETTINGS = {
    MAX_LINES: 3,
    ANIMATION_SPEED: 0.7,
    SEGMENT_DURATION: 300,
    PREDICTION_START_POINT: 9,
    RANDOM_FACTOR: 0.5,
    TURBULENCE: 0.3,
    RESOLUTION: 50,
    FIELD_SIZE: 8,
    NOISE_SCALE: 0.2
};

let currentSettings = { ...DEFAULT_SETTINGS };

// Add to state variables
let globalPathMemory = {
    successfulPaths: [],
    weightedRegions: new Map()
};

// Create a class to manage each line set
class LineSet {
    constructor(scene, index) {
        this.scene = scene;
        this.index = index;
        this.color = new THREE.Color().setHSL(index / currentSettings.MAX_LINES, 1, 0.5);
        
        // Initialize arrays and state variables
        this.allPoints = [];
        this.lineColors = [];
        this.currentPathIndex = 0;
        this.isAnimating = false;
        this.animationProgress = 0;
        this.predictionPoints = [];
        
        this.initialize();
        this.learnFromPreviousLines();
    }

    initialize() {
        // Create the lines
        this.combinedLine = new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({
                vertexColors: true,
                linewidth: 16,
                transparent: true,
                opacity: 1.0
            })
        );

        this.glowLine = new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({
                vertexColors: true,
                linewidth: 32,
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending
            })
        );

        this.scene.add(this.glowLine);
        this.scene.add(this.combinedLine);

        // Modify material colors to use this.color
        this.combinedLine.material.color = this.color;
    }

    startPath() {
        if (!tokenCloud) {
            console.error('Token cloud not available');
            return;
        }

        // Get random starting point
        const positions = tokenCloud.geometry.attributes.position;
        const count = positions.array.length / 3;
        const randomIndex = Math.floor(Math.random() * count) * 3;
        const startPoint = new THREE.Vector3(
            positions.array[randomIndex],
            positions.array[randomIndex + 1],
            positions.array[randomIndex + 2]
        );

        this.allPoints.push(startPoint.clone());
        this.lineColors.push(new THREE.Color(0x00ffff));
        this.animateNextSegment();
    }

    animateNextSegment() {
        if (this.currentPathIndex >= 30) {
            console.log('Truth path complete');
            this.addPredictionPoints();
            return;
        }

        if (!this.isAnimating) {
            this.isAnimating = true;
            this.animationProgress = 0;
            
            const positions = tokenCloud.geometry.attributes.position;
            const weights = tokenCloud.geometry.attributes.weight;
            
            const currentPoint = this.allPoints[this.currentPathIndex];
            const nextPoint = this.findNextHighestWeightPoint(currentPoint, positions, weights);
            
            const animate = () => {
                this.animationProgress += ANIMATION_SPEED * (16.67 / SEGMENT_DURATION);
                
                if (this.animationProgress >= 1) {
                    this.allPoints.push(nextPoint.clone());
                    this.lineColors.push(new THREE.Color(0x00ffff));
                    this.updatePathGeometry();
                    
                    if (this.currentPathIndex === PATH_CONSTANTS.PREDICTION_START_POINT - 1) {
                        const prediction = this.predictFullPath(this.allPoints.slice(0, PATH_CONSTANTS.PREDICTION_START_POINT));
                        storedPrediction = prediction;
                        this.predictionPoints = prediction.paths[0];
                    }
                    
                    this.isAnimating = false;
                    this.currentPathIndex++;
                    setTimeout(() => this.animateNextSegment(), 50);
                    return;
                }
                
                const interpolatedPoint = new THREE.Vector3().lerpVectors(
                    currentPoint,
                    nextPoint,
                    this.animationProgress
                );
                
                const currentPoints = [...this.allPoints, interpolatedPoint];
                const currentColors = [...this.lineColors, new THREE.Color(0x00ffff)];
                
                this.updatePathGeometry();
                
                requestAnimationFrame(animate);
            };
            
            animate();
        }
    }

    findNextHighestWeightPoint(currentPoint, positions, weights) {
        // Validate input point
        if (!this.validatePoint(currentPoint)) {
            console.error('Invalid current point:', currentPoint);
            return currentPoint.clone(); // Return safe value
        }

        const fieldStrength = (point) => {
            let elevation = 0;
            const maxInfluence = 2.0;
            
            // Increase random variation
            const randomFactor = 0.5;
            const random = Math.random() * randomFactor;
            
            // Add turbulence
            const turbulence = Math.sin(point.x * 5) * Math.cos(point.z * 5) * 0.3;
            
            for (let i = 0; i < positions.array.length; i += 3) {
                const tokenPos = new THREE.Vector3(
                    positions.array[i],
                    positions.array[i + 1],
                    positions.array[i + 2]
                );
                
                const distance = point.distanceTo(tokenPos);
                if (distance < maxInfluence) {
                    const weight = weights.array[i / 3];
                    elevation += (weight + random + turbulence) / (1 + distance * distance);
                }
            }
            
            // Add bias from learned successful paths
            const learnedBias = this.getLearnedBias(point);
            elevation += learnedBias;
            
            return elevation;
        };

        const randomOffset = new THREE.Vector3(
            (Math.random() - 0.5) * 0.4,
            (Math.random() - 0.5) * 0.4,
            (Math.random() - 0.5) * 0.4
        );
        
        let currentPos = currentPoint.clone().add(randomOffset);
        
        const steps = 12;
        const stepSize = 0.15;
        
        for (let i = 0; i < steps; i++) {
            const gradient = new THREE.Vector3();
            const delta = 0.1;
            
            const center = fieldStrength(currentPos);
            
            ['x', 'y', 'z'].forEach(axis => {
                const testPoint = currentPos.clone();
                testPoint[axis] += delta;
                const heightDiff = fieldStrength(testPoint) - center;
                gradient[axis] = heightDiff / delta;
            });
            
            gradient.normalize().multiplyScalar(stepSize);
            gradient.add(randomOffset.multiplyScalar(0.1));
            currentPos.add(gradient);
        }
        
        // Validate output point before returning
        if (!this.validatePoint(currentPos)) {
            console.error('Generated invalid point:', currentPos);
            return currentPoint.clone(); // Return safe value
        }
        
        return currentPos;
    }

    predictFullPath(currentPoints) {
        console.log('Generating prediction from current points:', currentPoints.length);
        const positions = tokenCloud.geometry.attributes.position;
        const weights = tokenCloud.geometry.attributes.weight;
        
        const predictedPath = [];
        let currentPoint = currentPoints[currentPoints.length - 1].clone();
        
        for (let i = 0; i < (30 - currentPoints.length); i++) {
            const nextPoint = this.findNextHighestWeightPoint(currentPoint, positions, weights);
            predictedPath.push(nextPoint.clone());
            currentPoint = nextPoint;
        }
        
        return {
            paths: [predictedPath],
            confidence: 0.85
        };
    }

    updatePathGeometry() {
        const positions = [];
        const colors = [];
        
        // Filter out invalid points
        const validPoints = this.allPoints.filter(point => this.validatePoint(point));
        
        validPoints.forEach((point, index) => {
            positions.push(point.x, point.y, point.z);
            const color = this.lineColors[index] || new THREE.Color(0x00ffff);
            colors.push(color.r, color.g, color.b);
        });
        
        // Only update geometry if we have valid points
        if (positions.length > 0) {
        this.combinedLine.geometry.setAttribute('position', 
            new THREE.Float32BufferAttribute(positions, 3));
        this.combinedLine.geometry.setAttribute('color', 
            new THREE.Float32BufferAttribute(colors, 3));
            
        this.glowLine.geometry.setAttribute('position', 
            new THREE.Float32BufferAttribute(positions, 3));
        this.glowLine.geometry.setAttribute('color', 
            new THREE.Float32BufferAttribute(colors, 3));
        }
    }

    addPredictionPoints() {
        if (!this.predictionPoints || this.predictionPoints.length === 0) {
            console.error('No prediction points available');
            return;
        }

        const predictionGeometry = new THREE.BufferGeometry();
        const predictionMaterial = new THREE.LineBasicMaterial({
            color: 0xffff00,
            linewidth: 16,
            transparent: true,
            opacity: 1.0
        });

        this.predictionLine = new THREE.Line(predictionGeometry, predictionMaterial);
        
        // Validate starting point
        const startPoint = this.allPoints[PATH_CONSTANTS.PREDICTION_START_POINT - 1];
        if (!startPoint || !this.validatePoint(startPoint)) {
            console.error('Invalid prediction start point');
            return;
        }

        const predictionPositions = [startPoint.clone()];

        const addNextPoint = (index) => {
            if (index >= this.predictionPoints.length) {
                console.log('Prediction Complete');
                return;
            }

            const nextPoint = this.predictionPoints[index];
            if (this.validatePoint(nextPoint)) {
                predictionPositions.push(nextPoint.clone());
                
                const positions = predictionPositions.flatMap(p => [p.x, p.y, p.z]);
            predictionGeometry.setAttribute('position', 
                new THREE.Float32BufferAttribute(positions, 3));
            }

            setTimeout(() => addNextPoint(index + 1), SEGMENT_DURATION);
        };

        this.scene.add(this.predictionLine);
        addNextPoint(0);
    }

    learnFromPreviousLines() {
        if (lineSets.length > 0) {
            // Learn from previous lines' successful paths
            const previousPaths = lineSets.map(set => ({
                points: set.allPoints,
                prediction: set.predictionPoints
            }));

            // Adjust our weight calculations based on previous successes
            this.adjustWeightCalculation(previousPaths);
        }
    }

    adjustWeightCalculation(previousPaths) {
        // Modify findNextHighestWeightPoint to consider successful paths
        const successfulRegions = this.analyzeSuccessfulRegions(previousPaths);
        // Bias our path towards regions where predictions matched truth
    }

    analyzeSuccessfulRegions(previousPaths) {
        const successfulRegions = new Map();
        
        previousPaths.forEach(path => {
            // Compare truth and prediction points
            const truthPoints = path.points;
            const predPoints = path.prediction;
            
            if (!predPoints) return;
            
            // Find regions where prediction matched truth
            for (let i = 0; i < predPoints.length; i++) {
                const predPoint = predPoints[i];
                const truthPoint = truthPoints[PATH_CONSTANTS.PREDICTION_START_POINT + i];
                
                if (!truthPoint) continue;
                
                const accuracy = 1 - predPoint.distanceTo(truthPoint);
                if (accuracy > 0.8) { // High accuracy threshold
                    const key = `${Math.round(predPoint.x)},${Math.round(predPoint.y)},${Math.round(predPoint.z)}`;
                    successfulRegions.set(key, (successfulRegions.get(key) || 0) + accuracy);
                }
            }
        });
        
        return successfulRegions;
    }

    getLearnedBias(point) {
        if (!this.successfulRegions) return 0;
        
        let bias = 0;
        const searchRadius = 1.0;
        
        this.successfulRegions.forEach((weight, key) => {
            const [x, y, z] = key.split(',').map(Number);
            const regionPoint = new THREE.Vector3(x, y, z);
            
            const distance = point.distanceTo(regionPoint);
            if (distance < searchRadius) {
                bias += (weight * (1 - distance / searchRadius));
            }
        });
        
        return bias * 0.3; // Scale the influence
    }

    // Add smooth path generation
    createSmoothPath(points, segments = 10) {
        if (points.length < 2) return points;
        
        const curve = new THREE.CatmullRomCurve3(points);
        return curve.getPoints(points.length * segments);
    }

    // Add token highlighting
    updateTokenColors(pathPoints) {
        if (!tokenCloud) return;
        
        const positions = tokenCloud.geometry.attributes.position;
        const colors = tokenCloud.geometry.attributes.color;
        const threshold = 0.2;
        
        for (let i = 0; i < positions.count; i++) {
            const point = new THREE.Vector3(
                positions.array[i * 3],
                positions.array[i * 3 + 1],
                positions.array[i * 3 + 2]
            );
            
            // Check if point is near path
            const isNearPath = pathPoints.some(pathPoint => 
                point.distanceTo(pathPoint) < threshold
            );
            
            if (isNearPath) {
                colors.array[i * 3] = 1;     // R
                colors.array[i * 3 + 1] = 1; // G
                colors.array[i * 3 + 2] = 1; // B
            }
        }
        
        colors.needsUpdate = true;
    }

    // Add a validation helper
    validatePoint(point) {
        return !isNaN(point.x) && !isNaN(point.y) && !isNaN(point.z) &&
               isFinite(point.x) && isFinite(point.y) && isFinite(point.z);
    }

    // ... we'll add more methods here
}

// Create a new modern UI container
function createModernUI() {
    const uiContainer = document.createElement('div');
    uiContainer.style.cssText = `
        position: fixed;
        left: 50%;
        bottom: 30px;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(10px);
        padding: 15px 30px;
        border-radius: 20px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        gap: 20px;
        align-items: center;
        z-index: 1000;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.2);
    `;

    // Create modern toggle buttons
    const createButton = (icon, label, onClick) => {
        const button = document.createElement('button');
        button.className = 'modern-button';
        button.innerHTML = `
            <span class="material-icons">${icon}</span>
            <span>${label}</span>
        `;
        button.onclick = onClick;
        return button;
    };

    // Add visualization controls
    const toggleCloudBtn = createButton(
        'visibility',
        'Toggle Cloud',
        () => {
            isCloudVisible = !isCloudVisible;
            gsap.to(tokenCloud.material, {
                opacity: isCloudVisible ? 1.0 : 0.0,
                duration: 0.8,
                ease: "power2.inOut"
            });
        }
    );

    const extractPathsBtn = createButton(
        'open_in_new',
        'Extract Paths',
        () => {
            const menu = document.createElement('div');
            menu.style.cssText = `
                position: absolute;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(10px);
                padding: 10px;
                border-radius: 15px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-bottom: 10px;
            `;

            const extractOptions = [
                { label: 'Extract Truth Paths', icon: 'timeline', action: 'truth' },
                { label: 'Extract Predictions', icon: 'alt_route', action: 'prediction' },
                { label: 'Extract All Paths', icon: 'call_split', action: 'both' }
            ];

            extractOptions.forEach(option => {
                const extractBtn = createButton(option.icon, option.label, () => {
                    isPathsExtracted = !isPathsExtracted;
                    const targetPos = isPathsExtracted ? extractedPosition : originalPathPosition;
                    const cloudOpacity = isPathsExtracted ? 0.1 : 1.0;

                    // Handle different extraction options for all line sets
                    lineSets.forEach(lineSet => {
                        switch(option.action) {
                            case 'truth':
                                gsap.to([lineSet.combinedLine.position, lineSet.glowLine.position], {
                                    x: targetPos.x,
                                    y: targetPos.y,
                                    z: targetPos.z,
                                    duration: 1.2,
                                    ease: "power2.inOut"
                                });
                                break;
                            case 'prediction':
                                if (lineSet.predictionLine) {
                                    gsap.to(lineSet.predictionLine.position, {
                                        x: targetPos.x,
                                        y: targetPos.y,
                                        z: targetPos.z,
                                        duration: 1.2,
                                        ease: "power2.inOut"
                                    });
                                }
                                break;
                            case 'both':
                                const elements = [lineSet.combinedLine.position, lineSet.glowLine.position];
                                if (lineSet.predictionLine) {
                                    elements.push(lineSet.predictionLine.position);
                                }
                                gsap.to(elements, {
                                    x: targetPos.x,
                                    y: targetPos.y,
                                    z: targetPos.z,
                                    duration: 1.2,
                                    ease: "power2.inOut"
                                });
                                break;
                        }
                    });

                    gsap.to(tokenCloud.material, {
                        opacity: cloudOpacity,
                        duration: 0.8,
                        ease: "power2.inOut"
                    });

                    if (isPathsExtracted) {
                        moveCamera({ x: 0, y: 0, z: 20 });
                    }
                    menu.remove();
                });
                menu.appendChild(extractBtn);
            });

            uiContainer.appendChild(menu);
        }
    );

    // Add camera controls
    const cameraControlsBtn = createButton(
        'videocam',
        'Camera Views',
        () => {
            const menu = document.createElement('div');
            menu.style.cssText = `
                position: absolute;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(10px);
                padding: 10px;
                border-radius: 15px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-bottom: 10px;
            `;

            const views = [
                { label: 'Front View', pos: CAMERA_POSITIONS.front },
                { label: 'Top View', pos: CAMERA_POSITIONS.top },
                { label: 'Side View', pos: CAMERA_POSITIONS.side },
                { label: 'Angle View', pos: CAMERA_POSITIONS.angle }
            ];

            views.forEach(view => {
                const viewBtn = createButton('camera', view.label, () => {
                    moveCamera(view.pos);
                    menu.remove();
                });
                menu.appendChild(viewBtn);
            });

            uiContainer.appendChild(menu);
        }
    );

    const settingsBtn = createButton(
        'settings',
        'Settings',
        showSettingsPanel
    );

    uiContainer.appendChild(settingsBtn);

    uiContainer.appendChild(toggleCloudBtn);
    uiContainer.appendChild(extractPathsBtn);
    uiContainer.appendChild(cameraControlsBtn);

    document.body.appendChild(uiContainer);
}

function showSettingsPanel() {
    const panel = document.createElement('div');
    panel.style.cssText = `
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        backdrop-filter: blur(10px);
        padding: 20px;
        border-radius: 15px;
        color: white;
        z-index: 1000;
        min-width: 300px;
    `;

    const settings = [
        { 
            label: 'Prediction Start Point', 
            key: 'PREDICTION_START_POINT', 
            min: 4, 
            max: 20, 
            step: 1,
            tooltip: 'Point at which prediction begins'
        },
        { 
            label: 'Number of Lines', 
            key: 'MAX_LINES', 
            min: 1, 
            max: 5, 
            step: 1,
            tooltip: 'Number of concurrent paths'
        },
        { 
            label: 'Line Spacing', 
            key: 'LINE_DELAY', 
            min: 500, 
            max: 5000, 
            step: 100,
            tooltip: 'Delay between new lines (ms)'
        },
        { 
            label: 'Randomness', 
            key: 'RANDOM_FACTOR', 
            min: 0, 
            max: 1, 
            step: 0.1,
            tooltip: 'Amount of random variation in paths'
        }
    ];

    settings.forEach(setting => {
        const container = document.createElement('div');
        container.style.cssText = `
            margin-bottom: 15px;
            display: flex;
            flex-direction: column;
            gap: 5px;
        `;

        const labelContainer = document.createElement('div');
        labelContainer.style.display = 'flex';
        labelContainer.style.justifyContent = 'space-between';

        const label = document.createElement('label');
        label.textContent = setting.label;

        const value = document.createElement('span');
        value.textContent = currentSettings[setting.key];

        labelContainer.appendChild(label);
        labelContainer.appendChild(value);

        const input = document.createElement('input');
        input.type = 'range';
        input.min = setting.min;
        input.max = setting.max;
        input.step = setting.step;
        input.value = currentSettings[setting.key];
        input.style.width = '100%';

        input.oninput = () => {
            currentSettings[setting.key] = parseFloat(input.value);
            value.textContent = input.value;
        };

        container.appendChild(labelContainer);
        container.appendChild(input);

        if (setting.tooltip) {
            const tooltip = document.createElement('small');
            tooltip.textContent = setting.tooltip;
            tooltip.style.opacity = '0.7';
            container.appendChild(tooltip);
        }

        panel.appendChild(container);
    });

    // Add apply/cancel buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 10px;
        margin-top: 20px;
        justify-content: flex-end;
    `;

    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply & Restart';
    applyBtn.onclick = () => {
        saveSettings();
        restartVisualization();
        panel.remove();
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
        currentSettings = { ...loadSettings() };
        panel.remove();
    };

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(applyBtn);
    panel.appendChild(buttonContainer);

    document.body.appendChild(panel);
}

// Update the controls legend style
const controlsLegend = document.querySelector('.controls-legend');
if (controlsLegend) {
    controlsLegend.style.cssText = `
        position: fixed;
        left: 20px;
        bottom: 20px;
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(10px);
        padding: 15px;
        border-radius: 15px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
        font-family: Arial;
        z-index: 100;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.2);
    `;
}

function init() {
    log('Initializing scene');
    try {
        // Create scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);

        // Setup camera
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.z = 10;

        // Setup renderer
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        document.body.appendChild(renderer.domElement);
        log('Renderer added to document');

        // Enhanced OrbitControls setup
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.rotateSpeed = 0.8;
        controls.panSpeed = 0.8;
        controls.zoomSpeed = 1.2;
        controls.enablePan = true;
        controls.enableZoom = true;
        controls.minDistance = 3;
        controls.maxDistance = 20;

        // Setup keyboard controls
        setupCameraControls();

        // Create modern UI first
        createModernUI();

        // Create token cloud
        createTokenCloud();

        // Animation loop
        animate();
        log('Initialization complete');
    } catch (error) {
        log('Error during initialization: ' + error.message);
        console.error(error);
    }
}

function createTokenCloud() {
    console.log('Creating token cloud...');
    try {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];
        const weights = [];

        // Create topographical distribution
        const resolution = 50; // Grid resolution
        const size = 8; // Total size of the field
        const noiseScale = 0.2; // Scale of the noise variation

        for (let i = 0; i < resolution; i++) {
            for (let j = 0; j < resolution; j++) {
                for (let k = 0; k < resolution; k++) {
                    const x = (i / resolution - 0.5) * size;
                    const y = (j / resolution - 0.5) * size;
                    const z = (k / resolution - 0.5) * size;

                    // Create topographical weight distribution
                    const elevation = Math.sin(x * noiseScale) * Math.cos(z * noiseScale) +
                                    Math.sin(y * noiseScale * 2) * 0.5 +
                                    Math.cos((x + z) * noiseScale * 0.5) * 0.3;
                    
                    const weight = Math.max(0, (elevation + 1) / 2);

                    if (weight > 0.3) { // Only add points above certain density
                        positions.push(x, y, z);
                        weights.push(weight);

                        // Color based on elevation/weight
                        const r = Math.min(1, (1 - weight) * 1.5);
                        const g = Math.min(1, weight * 1.5);
                        const b = 0.3 + Math.sin(elevation) * 0.2;
                        colors.push(r, g, b);
                    }
                }
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setAttribute('weight', new THREE.Float32BufferAttribute(weights, 1));

        const material = new THREE.PointsMaterial({
            size: 0.06,
            vertexColors: true,
            sizeAttenuation: true,
            map: createCircleTexture(),
            transparent: true,
            alphaTest: 0.1,
            blending: THREE.AdditiveBlending,
            opacity: 1.12
        });

        const points = new THREE.Points(geometry, material);
        scene.add(points);
        tokenCloud = points;

        console.log('Cloud ready');
        setTimeout(() => animatePath(), 1000);
    } catch (error) {
        console.error('Error creating token cloud:', error);
    }
}

function createCircleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.4)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

// Modify the animate function to remove spacebar check
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// Handle window resizing
window.addEventListener('resize', onWindowResize, false);

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

console.log('Starting initialization');
init(); 

function animatePath() {
    console.log('Starting path generation...');
    
    if (lineCount >= MAX_LINES) return;
    
    // Create new line set with index
    const lineSet = new LineSet(scene, lineCount);
    lineSets.push(lineSet);
    lineCount++;
    
    // Start the path
    lineSet.startPath();
    
    // Start another path after a delay
    if (lineCount < MAX_LINES) {
        setTimeout(() => animatePath(), 2000);
    }
}

function calculateDirectionFactor(currentPoint, candidatePoint) {
    if (pathPoints.length < 2) {
        return 1.0;
    }
    
    const prevPoint = pathPoints[pathPoints.length - 2],
          currentDir = new THREE.Vector3().subVectors(currentPoint, prevPoint).normalize(),
          candidateDir = new THREE.Vector3().subVectors(candidatePoint, currentPoint).normalize();
    
    // Prefer smooth directional changes
    const angle = currentDir.dot(candidateDir);
    return (angle + 1) / 2; // Normalize to 0-1 range
}

function calculateLocalDensity(point, positions, weights) {
    let density = 0;
    const radius = 1.0;
    
    for (let i = 0; i < positions.array.length; i += 3) {
        const testPoint = new THREE.Vector3(
            positions.array[i],
            positions.array[i + 1],
            positions.array[i + 2]
        );
        
        const distance = point.distanceTo(testPoint);
        if (distance < radius) {
            density += weights.array[i / 3] * (1 - distance / radius);
        }
    }
    
    return Math.min(density / 10, 1); // Normalize to 0-1 range
}

function calculateCurvatureFactor(point) {
    if (pathPoints.length < 3) return 1.0;
    
    const p1 = pathPoints[pathPoints.length - 3];
    const p2 = pathPoints[pathPoints.length - 2];
    const p3 = pathPoints[pathPoints.length - 1];
    
    // Calculate approximate curvature
    const v1 = new THREE.Vector3().subVectors(p2, p1);
    const v2 = new THREE.Vector3().subVectors(p3, p2);
    const v3 = new THREE.Vector3().subVectors(point, p3);
    
    const c1 = v1.angleTo(v2);
    const c2 = v2.angleTo(v3);
    
    // Prefer consistent curvature
    return 1 - Math.abs(c1 - c2) / Math.PI;
}

function smoothPathSegment(start, end, positions, weights) {
    const steps = 5;
    const points = [start];
    
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const interpolated = new THREE.Vector3().lerpVectors(start, end, t);
        
        // Adjust position based on local density
        const offset = calculateDensityOffset(interpolated, positions, weights);
        interpolated.add(offset);
        
        points.push(interpolated);
    }
    
    points.push(end);
    
    // Return smoothed endpoint
    return points[points.length - 1];
}

function calculateDensityOffset(point, positions, weights) {
    const offset = new THREE.Vector3();
    const radius = 1.0;
    
    for (let i = 0; i < positions.array.length; i += 3) {
        const testPoint = new THREE.Vector3(
            positions.array[i],
            positions.array[i + 1],
            positions.array[i + 2]
        );
        
        const distance = point.distanceTo(testPoint);
        if (distance < radius && distance > 0) {
            const weight = weights.array[i / 3];
            const influence = weight * (1 - distance / radius);
            offset.add(testPoint.sub(point).multiplyScalar(influence / distance));
        }
    }
    
    return offset.multiplyScalar(0.1); // Scale down the influence
}

function calculateDivergence() {
    if (!storedPrediction || !pathPoints) return 0;
    
    const predictedPoints = storedPrediction.paths[0];
    let totalDivergence = 0;
    
    // Calculate average distance between predicted and actual points
    for (let i = 4; i < pathPoints.length && i < predictedPoints.length; i++) {
        const actualPoint = pathPoints[i];
        const predictedPoint = predictedPoints[i - 4]; // Offset by 4 initial points
        totalDivergence += actualPoint.distanceTo(predictedPoint);
    }
    
    return Math.round((1 - (totalDivergence / pathPoints.length)) * 100);
}

function calculateDirectionScore(currentPoint, candidatePoint, pattern) {
    // Calculate how well this point follows the established direction trend
    const proposedDirection = new THREE.Vector3()
        .subVectors(candidatePoint, currentPoint)
        .normalize();
    
    const trendDirection = pattern.directionTrend.normalize();
    
    // Return 1 for perfect alignment, 0 for perpendicular, -1 for opposite
    return proposedDirection.dot(trendDirection);
}

// New function to handle prediction continuation
function continueWithPrediction() {
    if (!storedPrediction || !predictionPoints || predictionPoints.length === 0) {
        console.error('No prediction data available');
        return;
    }

    // Start from the last truth point
    const lastTruthPoint = pathPoints[pathPoints.length - 1];
    const firstPredictionPoint = predictionPoints[0];

    // Create smooth transition between truth and prediction
    const transitionPoints = createTransitionCurve(lastTruthPoint, firstPredictionPoint);
    
    // Add transition points to the line
    transitionPoints.forEach(point => {
        pathPoints.push(point.clone());
    });

    // Add prediction points
    predictionPoints.forEach(point => {
        pathPoints.push(point.clone());
    });

    // Update the line geometry with all points
    updatePathGeometry(pathLine);
}

// Helper function to create smooth transition
function createTransitionCurve(start, end) {
    const points = [];
    const steps = 10;
    
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // Use cubic interpolation for smoother transition
        const point = new THREE.Vector3().lerpVectors(start, end, t);
        points.push(point);
    }
    
    return points;
}

// Add new function to handle prediction animation
function startPredictionAnimation() {
    if (!storedPrediction || !predictionPoints || predictionPoints.length === 0) {
        console.error('No prediction data available');
        return;
    }
    
    isPredictionAnimating = true;
    predictionAnimationProgress = 0;
    
    const animate = () => {
        if (!isPredictionAnimating) return;
        
        predictionAnimationProgress += ANIMATION_SPEED * (16.67 / SEGMENT_DURATION);
        
        if (predictionAnimationProgress >= 1) {
            // Show full prediction line
            const predictionVertices = [];
            predictionPoints.forEach(point => {
                predictionVertices.push(point.x, point.y, point.z);
            });
            pathLine.geometry.setAttribute('position',
                new THREE.Float32BufferAttribute(predictionVertices, 3));
            
            isPredictionAnimating = false;
            console.log('Prediction animation complete');
            return;
        }
        
        // Animate prediction line growing
        const numPoints = Math.floor(predictionPoints.length * predictionAnimationProgress);
        const predictionVertices = [];
        
        // Ensure we have at least one point
        if (numPoints < 1) {
            const firstPoint = predictionPoints[0];
            predictionVertices.push(firstPoint.x, firstPoint.y, firstPoint.z);
        } else {
            // Add all complete segments
            for (let i = 0; i < Math.min(numPoints, predictionPoints.length); i++) {
                const point = predictionPoints[i];
                predictionVertices.push(point.x, point.y, point.z);
            }
            
            // Add interpolated last point if we're not at the end
            if (numPoints < predictionPoints.length - 1) {
                const lastPoint = predictionPoints[numPoints];
                const nextPoint = predictionPoints[Math.min(numPoints + 1, predictionPoints.length - 1)];
                const partialProgress = (predictionAnimationProgress * predictionPoints.length) % 1;
                
                const interpolatedPoint = new THREE.Vector3().lerpVectors(
                    lastPoint,
                    nextPoint,
                    partialProgress
                );
                predictionVertices.push(interpolatedPoint.x, interpolatedPoint.y, interpolatedPoint.z);
            }
        }
        
        // Only update geometry if we have points
        if (predictionVertices.length > 0) {
            pathLine.geometry.setAttribute('position',
                new THREE.Float32BufferAttribute(predictionVertices, 3));
        }
        
        requestAnimationFrame(animate);
    };
    
    animate();
}

// Add this after camera setup in init()
function setupCameraControls() {
    // Add keyboard controls for camera positions
    window.addEventListener('keydown', (event) => {
        switch(event.key) {
            case '1':
                moveCamera(CAMERA_POSITIONS.front);
                break;
            case '2':
                moveCamera(CAMERA_POSITIONS.top);
                break;
            case '3':
                moveCamera(CAMERA_POSITIONS.side);
                break;
            case '4':
                moveCamera(CAMERA_POSITIONS.angle);
                break;
            case 'r':
                // Reset camera to default position
                moveCamera(CAMERA_POSITIONS.front);
                break;
        }
    });
}

function moveCamera(position) {
    const duration = 1000;
    const startPosition = camera.position.clone();
    const startTime = Date.now();

    function animateCamera() {
        const now = Date.now();
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Smooth easing
        const eased = progress < .5 ? 
            2 * progress * progress : 
            -1 + (4 - 2 * progress) * progress;

        camera.position.x = startPosition.x + (position.x - startPosition.x) * eased;
        camera.position.y = startPosition.y + (position.y - startPosition.y) * eased;
        camera.position.z = startPosition.z + (position.z - startPosition.z) * eased;

        camera.lookAt(0, 0, 0);

        if (progress < 1) {
            requestAnimationFrame(animateCamera);
        }
    }

    animateCamera();
}

// Add toggle button after paths complete
function addVisualizationControls() {
    const controlPanel = document.createElement('div');
    controlPanel.style.cssText = `
        position: fixed;
        left: 20px;
        top: 20px;
        background: rgba(0, 0, 0, 0.8);
        padding: 10px;
        border-radius: 5px;
        z-index: 100;
    `;

    const toggleButton = document.createElement('button');
    toggleButton.textContent = 'Toggle Cloud Visibility';
    toggleButton.style.cssText = `
        background: #444;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
    `;

    toggleButton.onclick = () => {
        isCloudVisible = !isCloudVisible;
        
        // Animate opacity transition
        gsap.to(tokenCloud.material, {
            opacity: isCloudVisible ? 1.0 : 0.0,
            duration: 0.8,
            ease: "power2.inOut"
        });
    };

    controlPanel.appendChild(toggleButton);
    document.body.appendChild(controlPanel);
}

function analyzeConvergence() {
    const results = [];
    
    // Test predictions starting from different points
    for(let startPoint = 4; startPoint < 25; startPoint++) {
        const prediction = predictFullPath(allPoints.slice(0, startPoint));
        const predictedPath = prediction.paths[0];
        
        // Calculate accuracy by comparing with actual path
        let totalDeviation = 0;
        let pointCount = 0;
        
        for(let i = 0; i < predictedPath.length; i++) {
            const truthIndex = startPoint + i;
            if (truthIndex >= allPoints.length) break;
            
            const deviation = predictedPath[i].distanceTo(allPoints[truthIndex]);
            totalDeviation += deviation;
            pointCount++;
        }
        
        const accuracy = 1 - (totalDeviation / pointCount);
        results.push({
            startPoint,
            accuracy: accuracy * 100
        });
        
        console.log(`Prediction from point ${startPoint}: ${accuracy.toFixed(2)}% accurate`);
    }
    
    return results;
}

// Add settings button to UI
function createSettingsPanel() {
    const settingsBtn = createButton(
        'settings',
        'Settings',
        () => {
            const panel = document.createElement('div');
            panel.style.cssText = `
                position: fixed;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.9);
                backdrop-filter: blur(10px);
                padding: 20px;
                border-radius: 15px;
                color: white;
                z-index: 1000;
            `;

            const settings = [
                { label: 'Number of Lines', key: 'MAX_LINES', min: 1, max: 10, step: 1 },
                { label: 'Animation Speed', key: 'ANIMATION_SPEED', min: 0.1, max: 2, step: 0.1 },
                { label: 'Prediction Start Point', key: 'PREDICTION_START_POINT', min: 4, max: 20, step: 1 },
                { label: 'Randomness', key: 'RANDOM_FACTOR', min: 0, max: 1, step: 0.1 },
                { label: 'Turbulence', key: 'TURBULENCE', min: 0, max: 1, step: 0.1 }
            ];

            settings.forEach(setting => {
                const container = document.createElement('div');
                container.style.marginBottom = '10px';
                
                const label = document.createElement('label');
                label.textContent = setting.label;
                
                const input = document.createElement('input');
                input.type = 'range';
                input.min = setting.min;
                input.max = setting.max;
                input.step = setting.step;
                input.value = currentSettings[setting.key];
                
                const value = document.createElement('span');
                value.textContent = currentSettings[setting.key];
                
                input.oninput = () => {
                    currentSettings[setting.key] = parseFloat(input.value);
                    value.textContent = input.value;
                };
                
                container.appendChild(label);
                container.appendChild(input);
                container.appendChild(value);
                panel.appendChild(container);
            });

            // Add buttons
            const buttonContainer = document.createElement('div');
            buttonContainer.style.marginTop = '20px';
            
            const applyBtn = document.createElement('button');
            applyBtn.textContent = 'Apply & Restart';
            applyBtn.onclick = () => {
                saveSettings();
                restartVisualization();
                panel.remove();
            };
            
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = () => {
                currentSettings = { ...loadSettings() };
                panel.remove();
            };
            
            buttonContainer.appendChild(applyBtn);
            buttonContainer.appendChild(cancelBtn);
            panel.appendChild(buttonContainer);
            
            document.body.appendChild(panel);
        }
    );
    
    return settingsBtn;
}

// Add data storage functions
function saveSettings() {
    const data = {
        settings: currentSettings,
        timestamp: new Date().toISOString(),
        results: lineSets.map(lineSet => ({
            truthPath: lineSet.allPoints,
            predictionPath: lineSet.predictionPoints,
            accuracy: calculateAccuracy(lineSet)
        }))
    };
    
    // Save to file using fetch
    fetch('/api/save-data', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });
}

function loadSettings() {
    return fetch('/api/load-settings')
        .then(res => res.json())
        .catch(() => DEFAULT_SETTINGS);
}