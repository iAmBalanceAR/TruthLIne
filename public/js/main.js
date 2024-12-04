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
const pathPoints = [];
let isAnimating = false;
let animationProgress = 0;
const ANIMATION_SPEED = 0.7;
const SEGMENT_DURATION = 300;
let predictionPoints = [];
let predictionAnimationProgress = 0;
let isPredictionAnimating = false;

const PATH_CONSTANTS = {
    ENERGY_THRESHOLD: 0.7,
    FOLD_INFLUENCE: 0.4,
    MIN_SEPARATION: 0.3,
    PREDICTION_POINTS: 4
};

// Add these camera positions near the top with other constants
const CAMERA_POSITIONS = {
    front: { x: 0, y: 0, z: 10 },
    top: { x: 0, y: 10, z: 0 },
    side: { x: 10, y: 0, z: 0 },
    angle: { x: 6, y: 6, z: 6 }
};

// Add this after the other state variables
const infoPanel = document.createElement('div');
infoPanel.style.cssText = `
    position: fixed;
    right: 20px;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(0, 0, 0, 0.8);
    padding: 20px;
    border-radius: 10px;
    color: white;
    font-family: Arial;
    min-width: 300px;
    max-width: 400px;
`;
document.body.appendChild(infoPanel);

// Add a legend panel for controls
const controlsLegend = document.createElement('div');
controlsLegend.style.cssText = `
    position: fixed;
    left: 20px;
    bottom: 20px;
    background: rgba(0, 0, 0, 0.8);
    padding: 15px;
    border-radius: 10px;
    color: white;
    font-family: Arial;
`;
controlsLegend.innerHTML = `
    <h3>Controls:</h3>
    <ul style="padding-left: 20px; margin: 5px 0;">
        <li>Left Click + Drag: Rotate View</li>
        <li>Right Click + Drag: Pan View</li>
        <li>Scroll: Zoom In/Out</li>
        <li>Number Keys:</li>
        <ul style="padding-left: 20px;">
            <li>1: Front View</li>
            <li>2: Top View</li>
            <li>3: Side View</li>
            <li>4: Angle View</li>
        </ul>
        <li>R: Reset Camera</li>
    </ul>
`;
document.body.appendChild(controlsLegend);

// Update the info panel content with more detailed information
function updateInfoPanel(text) {
    let confidenceInfo = '';
    if (storedPrediction) {
        confidenceInfo = `
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.3);">
                <h4 style="margin: 0 0 5px 0;">Prediction Stats:</h4>
                <p style="margin: 5px 0;">Confidence: ${Math.round(storedPrediction.confidence * 100)}%</p>
                <p style="margin: 5px 0;">Divergence: ${calculateDivergence()}%</p>
            </div>
        `;
    }

    infoPanel.innerHTML = `
        <div>
            ${text}
            ${confidenceInfo}
        </div>
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

const caption = document.getElementById('caption');
function updateCaption(text) {
    if (caption) {
        caption.textContent = text;
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
        window.tokenCloud = points;

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

// At the top with other state variables
let allPoints = [];
let lineColors = [];

function animatePath() {
    console.log('Starting path generation...');
    
    if (!window.tokenCloud) {
        console.error('Token cloud not available');
        return;
    }
    
    // Clear existing line
    if (combinedLine) scene.remove(combinedLine);
    allPoints = [];
    lineColors = [];
    currentPathIndex = 0;
    isAnimating = false;
    animationProgress = 0;

    // Create single line for both truth and prediction
    combinedLine = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
            vertexColors: true,
            linewidth: 16,
            transparent: true,
            opacity: 1.0
        })
    );

    // Add a glow effect line that follows the main line
    glowLine = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
            vertexColors: true,
            linewidth: 32,  // Increased width for more visible glow
            transparent: true,
            opacity: 0.6,   // Increased opacity
            blending: THREE.AdditiveBlending
        })
    );

    scene.add(glowLine);    // Add glow line first
    scene.add(combinedLine); // Then add main line

    // Get starting point
    const positions = window.tokenCloud.geometry.attributes.position;
    const startPoint = new THREE.Vector3(
        positions.array[0],
        positions.array[1],
        positions.array[2]
    );
    allPoints.push(startPoint.clone());
    lineColors.push(new THREE.Color(0x00ffff)); // Cyan for truth path

    animateNextSegment();
}

function updatePathGeometry() {
    const positions = [];
    const colors = [];
    
    allPoints.forEach((point, index) => {
        positions.push(point.x, point.y, point.z);
        const color = lineColors[index] || new THREE.Color(0x00ffff);
        colors.push(color.r, color.g, color.b);
    });
    
    // Update main line
    combinedLine.geometry.setAttribute('position', 
        new THREE.Float32BufferAttribute(positions, 3));
    combinedLine.geometry.setAttribute('color', 
        new THREE.Float32BufferAttribute(colors, 3));
        
    // Update glow line
    glowLine.geometry.setAttribute('position', 
        new THREE.Float32BufferAttribute(positions, 3));
    glowLine.geometry.setAttribute('color', 
        new THREE.Float32BufferAttribute(colors, 3));
}

function animateNextSegment() {
    if (currentPathIndex >= 30) {
        console.log('Truth path complete');
        updateInfoPanel(`
            <h3>Path Generation Complete</h3>
            <p>Starting prediction calculation...</p>
            <div class="progress">
                <p>Truth Path: 100%</p>
                <p>Points: ${currentPathIndex}/30</p>
            </div>
        `);
        addPredictionPoints();
        return;
    }

    if (!isAnimating) {
        isAnimating = true;
        animationProgress = 0;
        
        const positions = window.tokenCloud.geometry.attributes.position;
        const weights = window.tokenCloud.geometry.attributes.weight;
        
        const currentPoint = allPoints[currentPathIndex];
        const nextPoint = findNextHighestWeightPoint(currentPoint, positions, weights);
        
        const animate = () => {
            animationProgress += ANIMATION_SPEED * (16.67 / SEGMENT_DURATION);
            
            if (animationProgress >= 1) {
                allPoints.push(nextPoint.clone());
                lineColors.push(new THREE.Color(0x00ffff));
                updatePathGeometry();
                
                if (currentPathIndex === 3) {
                    const prediction = predictFullPath(allPoints.slice(0, 4));
                    storedPrediction = prediction;
                    predictionPoints = prediction.paths[0];
                }
                
                isAnimating = false;
                currentPathIndex++;
                setTimeout(() => animateNextSegment(), 50);
                return;
            }
            
            const interpolatedPoint = new THREE.Vector3().lerpVectors(
                currentPoint,
                nextPoint,
                animationProgress
            );
            
            const currentPoints = [...allPoints, interpolatedPoint];
            const currentColors = [...lineColors, new THREE.Color(0x00ffff)];
            
            updatePathGeometry();
            
            requestAnimationFrame(animate);
        };
        
        animate();
    }
}

function addPredictionPoints() {
    if (!predictionPoints || predictionPoints.length === 0) {
        console.error('No prediction points available');
        return;
    }

    const addNextPoint = (index) => {
        // Stop TWO points early to prevent the artifact
        if (index >= predictionPoints.length - 2) {
            updateInfoPanel(`
                <h3>Prediction Complete</h3>
                <div class="progress">
                    <p>Truth Path: Complete</p>
                    <p>Prediction: Complete</p>
                </div>
            `);
            return;
        }

        allPoints.push(predictionPoints[index].clone());
        lineColors.push(new THREE.Color(0xffff00));
        updatePathGeometry();

        setTimeout(() => addNextPoint(index + 1), SEGMENT_DURATION);
    };

    addNextPoint(0);
}

function findNextHighestWeightPoint(currentPoint, positions, weights) {
    const fieldStrength = (point) => {
        let elevation = 0;
        const maxInfluence = 2.0;
        
        // Add random variation to each sample
        const randomFactor = 0.3; // Adjust this to control randomness
        const random = Math.random() * randomFactor;
        
        for (let i = 0; i < positions.array.length; i += 3) {
            const tokenPos = new THREE.Vector3(
                positions.array[i],
                positions.array[i + 1],
                positions.array[i + 2]
            );
            
            const distance = point.distanceTo(tokenPos);
            if (distance < maxInfluence) {
                const weight = weights.array[i / 3];
                // Add random variation to weight influence
                elevation += (weight + random) / (1 + distance * distance);
            }
        }
        
        return elevation;
    };

    // Add slight random offset to starting position
    const randomOffset = new THREE.Vector3(
        (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.2
    );
    let currentPos = currentPoint.clone().add(randomOffset);
    
    // Rest of the function remains the same...
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
        // Add small random deviation to path
        gradient.add(randomOffset.multiplyScalar(0.1));
        currentPos.add(gradient);
    }
    
    return currentPos;
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

function predictFullPath(currentPoints) {
    console.log('Generating prediction from current points:', currentPoints.length);
    const positions = window.tokenCloud.geometry.attributes.position;
    const weights = window.tokenCloud.geometry.attributes.weight;
    
    const predictedPath = [];
    let currentPoint = currentPoints[currentPoints.length - 1].clone();
    
    // Generate remaining points (adjusted for new total length)
    for (let i = 0; i < (30 - currentPoints.length); i++) {
        const nextPoint = findNextHighestWeightPoint(currentPoint, positions, weights, 2.0);
        predictedPath.push(nextPoint.clone());
        currentPoint = nextPoint;
    }
    
    return {
        paths: [predictedPath],
        confidence: 0.85
    };
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