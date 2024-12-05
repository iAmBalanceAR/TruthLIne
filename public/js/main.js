import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Global variables
let scene, camera, renderer, controls;
let tokenCloud = null;
let lineSets = [];
let lineCount = 0;
let isCloudVisible = true;
let isPathsExtracted = false;
const originalPathPosition = new THREE.Vector3();
const extractedPosition = new THREE.Vector3(0, 0, -15);
const SEGMENT_DURATION = 300;

const debug = document.getElementById('debug');
function log(message) {
    console.log(message);
    if (debug) {
        debug.innerHTML += message + '<br>';
    }
}

console.log('main.js loaded - starting initialization');

const DEFAULT_SETTINGS = {
    PREDICTION_START_POINT: 9,
    MAX_LINES: 3,
    LINE_DELAY: 2000,
    RANDOM_FACTOR: 0.5,
    PATH_LENGTH: 30,
    TOKEN_DENSITY: 0.3,
    ANIMATION_SPEED: 0.7
};

let currentSettings = { ...DEFAULT_SETTINGS };

const PATH_CONSTANTS = {
    ENERGY_THRESHOLD: 0.7,
    FOLD_INFLUENCE: 0.4,
    MIN_SEPARATION: 0.3,
    PREDICTION_START_POINT: 9
};

function restartVisualization() {
    // Show loading indicator
    const loading = document.createElement('div');
    loading.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 20px;
        border-radius: 10px;
        z-index: 1000;
    `;
    loading.textContent = 'Restarting Visualization...';
    document.body.appendChild(loading);

    // Clear existing lines
    lineSets.forEach(lineSet => {
        if (lineSet.combinedLine) scene.remove(lineSet.combinedLine);
        if (lineSet.glowLine) scene.remove(lineSet.glowLine);
        if (lineSet.predictionLine) scene.remove(lineSet.predictionLine);
    });
    
    // Reset state
    lineSets.length = 0;
    lineCount = 0;
    
    // Start new visualization
    setTimeout(() => {
        animatePath();
        loading.remove();
    }, 100);
}

// Settings storage functions
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

    localStorage.setItem('pathSettings', JSON.stringify(data));
}

function loadSettings() {
    try {
        const saved = localStorage.getItem('pathSettings');
        return saved ? JSON.parse(saved).settings : DEFAULT_SETTINGS;
    } catch (e) {
        console.error('Error loading settings:', e);
        return DEFAULT_SETTINGS;
    }
}

function calculateAccuracy(lineSet) {
    if (!lineSet.predictionPoints || !lineSet.allPoints) return 0;
    
    let totalDeviation = 0;
    let pointCount = 0;
    
    for (let i = 0; i < lineSet.predictionPoints.length; i++) {
        const truthIndex = PATH_CONSTANTS.PREDICTION_START_POINT + i;
        if (truthIndex >= lineSet.allPoints.length) break;
        
        const deviation = lineSet.predictionPoints[i].distanceTo(lineSet.allPoints[truthIndex]);
        totalDeviation += deviation;
        pointCount++;
    }
    
    return pointCount > 0 ? 1 - (totalDeviation / pointCount) : 0;
}

function showSettingsPanel() {
    const panel = document.createElement('div');
    panel.style.cssText = `
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.9);
        backdrop-filter: blur(10px);
        padding: 20px;
        border-radius: 15px;
        color: white;
        z-index: 1000;
        min-width: 300px;
        box-shadow: 0 0 20px rgba(0,0,0,0.5);
        max-height: 80vh;
        overflow-y: auto;
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
        },
        { 
            label: 'Path Length', 
            key: 'PATH_LENGTH', 
            min: 20, 
            max: 50, 
            step: 5,
            tooltip: 'Total length of each path'
        },
        { 
            label: 'Token Density', 
            key: 'TOKEN_DENSITY', 
            min: 0.2, 
            max: 0.8, 
            step: 0.1,
            tooltip: 'Density of tokens in the cloud'
        },
        {
            label: 'Animation Speed',
            key: 'ANIMATION_SPEED',
            min: 0.1,
            max: 2.0,
            step: 0.1,
            tooltip: 'Speed of path animation'
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

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 10px;
        margin-top: 20px;
        justify-content: flex-end;
    `;

    const buttonStyle = `
        background: #2a2a2a;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        color: white;
        cursor: pointer;
        transition: background 0.3s;
    `;

    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply & Restart';
    applyBtn.style.cssText = buttonStyle + 'background: #4CAF50;';
    applyBtn.onclick = () => {
        saveSettings();
        restartVisualization();
        panel.remove();
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = buttonStyle;
    cancelBtn.onclick = () => {
        currentSettings = { ...loadSettings() };
        panel.remove();
    };

    [applyBtn, cancelBtn].forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            btn.style.filter = 'brightness(1.2)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.filter = 'none';
        });
    });

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(applyBtn);
    panel.appendChild(buttonContainer);

    document.body.appendChild(panel);
}

function createButton(icon, label, onClick) {
    const button = document.createElement('button');
    button.className = 'modern-button';
    button.innerHTML = `
        <span class="material-icons">${icon}</span>
        <span>${label}</span>
    `;
    button.onclick = onClick;
    return button;
}

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

    const settingsBtn = createButton(
        'settings',
        'Settings',
        showSettingsPanel
    );

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
                { label: 'Front View', pos: { x: 0, y: 0, z: 10 } },
                { label: 'Top View', pos: { x: 0, y: 10, z: 0 } },
                { label: 'Side View', pos: { x: 10, y: 0, z: 0 } },
                { label: 'Angle View', pos: { x: 6, y: 6, z: 6 } }
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

    uiContainer.appendChild(settingsBtn);
    uiContainer.appendChild(toggleCloudBtn);
    uiContainer.appendChild(extractPathsBtn);
    uiContainer.appendChild(cameraControlsBtn);

    document.body.appendChild(uiContainer);
}

function animatePath() {
    if (lineCount >= currentSettings.MAX_LINES) return;
    
    const lineSet = new LineSet(scene, lineCount);
    lineSets.push(lineSet);
    lineCount++;
    
    lineSet.startPath();
    
    if (lineCount < currentSettings.MAX_LINES) {
        setTimeout(() => animatePath(), currentSettings.LINE_DELAY);
    }
}

class LineSet {
    constructor(scene, index) {
        this.scene = scene;
        this.index = index;
        this.color = new THREE.Color().setHSL(index / currentSettings.MAX_LINES, 1, 0.5);
        
        // Remove physics-related state
        this.allPoints = [];
        this.lineColors = [];
        this.currentPathIndex = 0;
        this.isAnimating = false;
        this.animationProgress = 0;
        this.predictionPoints = [];
        this.lastDirection = new THREE.Vector3();
        
        this.initialize();
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
        this.lineColors.push(this.color);
        this.animateNextSegment();
    }

    animateNextSegment() {
        if (this.currentPathIndex >= currentSettings.PATH_LENGTH) {
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
            const nextPoint = this.findNextHighestWeightPoint(currentPoint, positions, weights, this.velocity, this.patterns);
            
            const animate = () => {
                this.animationProgress += currentSettings.ANIMATION_SPEED * (16.67 / SEGMENT_DURATION);
                
                if (this.animationProgress >= 1) {
                    this.allPoints.push(nextPoint.clone());
                    this.lineColors.push(this.color);
                    this.updatePathGeometry();
                    
                    if (this.currentPathIndex === currentSettings.PREDICTION_START_POINT - 1) {
                        const prediction = this.predictFullPath(this.allPoints.slice(0, currentSettings.PREDICTION_START_POINT));
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
                this.updatePathGeometry(currentPoints);
                
                requestAnimationFrame(animate);
            };
            
            animate();
        }
    }

    predictFullPath(currentPoints) {
        const context = currentPoints.slice(-4);
        const startPoint = currentPoints[currentPoints.length - 1];
        
        // Calculate the pattern in local space (relative to start point)
        const movements = [];
        for (let i = 1; i < context.length; i++) {
            const localPoint = context[i].clone().sub(startPoint);
            const prevLocalPoint = context[i-1].clone().sub(startPoint);
            movements.push({
                direction: localPoint.sub(prevLocalPoint),
                distance: localPoint.length()
            });
        }
        
        // Use the actual start point for prediction
        const predictedPath = [];
        let currentPoint = startPoint.clone();
        let currentDirection = movements[movements.length - 1].direction.normalize();

        // Invert the initial direction
        currentDirection.multiplyScalar(-1);

        for (let i = 0; i < (currentSettings.PATH_LENGTH - currentPoints.length); i++) {
            // Add slight variation to prevent straight lines
            const variation = new THREE.Vector3(
                (Math.random() - 0.5) * 0.05,
                (Math.random() - 0.5) * 0.05,
                (Math.random() - 0.5) * 0.05
            );
            currentDirection.add(variation).normalize();

            // Move in the inverted direction
            const nextPoint = currentPoint.clone().add(
                currentDirection.multiplyScalar(movements[movements.length - 1].distance)
            );
            
            predictedPath.push(nextPoint);
            currentPoint = nextPoint;
            
            // Keep inverting the direction for each step
            currentDirection = nextPoint.clone()
                .sub(currentPoint)
                .normalize()
                .multiplyScalar(-1);
        }

        return {
            paths: [predictedPath],
            confidence: 0.85
        };
    }

    calculateAverageStepSize(points) {
        let totalDistance = 0;
        for (let i = 1; i < points.length; i++) {
            totalDistance += points[i].distanceTo(points[i-1]);
        }
        return totalDistance / (points.length - 1);
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
        this.scene.add(this.predictionLine);

        const startPoint = this.allPoints[currentSettings.PREDICTION_START_POINT - 1].clone();
        const predictionPositions = [startPoint];

        const addNextPoint = (index) => {
            if (index >= this.predictionPoints.length) {
                console.log('Prediction Complete');
                return;
            }

            predictionPositions.push(this.predictionPoints[index].clone());
            
            const positions = predictionPositions.flatMap(p => [p.x, p.y, p.z]);
            predictionGeometry.setAttribute('position', 
                new THREE.Float32BufferAttribute(positions, 3));

            setTimeout(() => addNextPoint(index + 1), SEGMENT_DURATION);
        };

        addNextPoint(0);
    }

    updatePathGeometry(points = this.allPoints) {
        const positions = [];
        const colors = [];
        
        points.forEach(point => {
            positions.push(point.x, point.y, point.z);
            colors.push(this.color.r, this.color.g, this.color.b);
        });
        
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

    rotateVelocity(velocity, angle) {
        // Convert angle to radians
        const rad = angle * Math.PI / 180;
        const rotated = velocity.clone();
        
        // Rotate in XZ plane
        const x = rotated.x * Math.cos(rad) - rotated.z * Math.sin(rad);
        const z = rotated.x * Math.sin(rad) + rotated.z * Math.cos(rad);
        rotated.x = x;
        rotated.z = z;
        
        return rotated;
    }

    evaluatePatternMatch(path, patterns) {
        if (!patterns) return 1;
        
        let score = 0;
        
        // Check velocity consistency
        const velocities = [];
        for (let i = 1; i < path.length; i++) {
            velocities.push(path[i].clone().sub(path[i-1]));
        }
        
        // Compare with observed patterns
        const avgVelocity = velocities.reduce((acc, vel) => acc.add(vel), new THREE.Vector3())
            .divideScalar(velocities.length);
        
        const velocityMatch = 1 - avgVelocity.clone()
            .sub(patterns.velocity)
            .length() / patterns.velocity.length();
            
        // Check turn rate consistency
        const turns = [];
        for (let i = 1; i < velocities.length; i++) {
            turns.push(velocities[i].angleTo(velocities[i-1]));
        }
        
        const avgTurnRate = turns.reduce((a, b) => a + b, 0) / turns.length;
        const turnMatch = 1 - Math.abs(avgTurnRate - patterns.turnRate) / Math.PI;
        
        score = (velocityMatch + turnMatch) / 2;
        return Math.max(0.1, score); // Ensure some minimum score
    }

    findNextHighestWeightPoint(currentPoint, positions, weights, currentVelocity, patterns) {
        // Remove all physics/gravity calculations
        const direction = new THREE.Vector3();
        const stepSize = 0.15; // Base step size
        
        // If we have patterns, use them
        if (patterns) {
            // Use pattern-based direction
            if (this.lastDirection) {
                direction.copy(this.lastDirection);
                // Apply learned turn rate
                if (patterns.turnRate) {
                    direction.applyAxisAngle(
                        new THREE.Vector3(0, 1, 0),
                        patterns.turnRate
                    );
                }
            } else {
                // Initial direction
                direction.set(
                    Math.random() - 0.5,
                    Math.random() - 0.5,
                    Math.random() - 0.5
                ).normalize();
            }
            
            // Use pattern-based step size if available
            const moveDistance = patterns.avgStepSize || stepSize;
            direction.multiplyScalar(moveDistance);
        } else {
            // Simple random walk for truth line
            direction.set(
                Math.random() - 0.5,
                Math.random() - 0.5,
                Math.random() - 0.5
            ).normalize().multiplyScalar(stepSize);
        }
        
        // Store for next iteration
        this.lastDirection = direction.clone().normalize();
        
        return currentPoint.clone().add(direction);
    }

    analyzeMovementPatterns(points) {
        const patterns = {
            velocity: new THREE.Vector3(),
            turnRate: 0,
            consistency: 0,
            avgStepSize: 0
        };

        if (points.length < 2) return patterns;

        // Calculate velocities between points
        const velocities = [];
        for (let i = 1; i < points.length; i++) {
            velocities.push(points[i].clone().sub(points[i-1]));
        }

        // Calculate average velocity (momentum)
        patterns.velocity = velocities.reduce((acc, vel) => acc.add(vel), new THREE.Vector3())
            .divideScalar(velocities.length);

        // Calculate turn rate and consistency
        let totalTurnAngle = 0;
        let angleVariance = 0;
        for (let i = 2; i < points.length; i++) {
            const v1 = velocities[i-2];
            const v2 = velocities[i-1];
            const angle = v1.angleTo(v2);
            totalTurnAngle += angle;
            angleVariance += Math.pow(angle - (totalTurnAngle / (i-1)), 2);
        }

        patterns.turnRate = totalTurnAngle / (points.length - 2);
        patterns.consistency = 1 - (angleVariance / (points.length - 2));
        patterns.avgStepSize = velocities.reduce((acc, vel) => acc + vel.length(), 0) / velocities.length;

        return patterns;
    }

    scoreTrajectory(trajectory) {
        if (!trajectory || !trajectory.path) return 0;
        
        const path = trajectory.path;
        let score = 0;
        
        // Weight different factors
        const weights = {
            energyEfficiency: 0.4,  // How well it conserves energy
            smoothness: 0.3,        // How smooth the turns are
            speedConsistency: 0.3   // How well it maintains speed
        };
        
        // Energy efficiency (from trajectory properties)
        score += trajectory.energyEfficiency * weights.energyEfficiency;
        
        // Path smoothness (from trajectory properties)
        score += trajectory.smoothness * weights.smoothness;
        
        // Speed consistency
        const speedScore = trajectory.averageSpeed;
        score += speedScore * weights.speedConsistency;
        
        // Normalize score to 0-1 range
        return Math.min(1, Math.max(0, score));
    }

    analyzeDirectionChanges(points) {
        const changes = [];
        for (let i = 2; i < points.length; i++) {
            const v1 = points[i].clone().sub(points[i-1]);
            const v2 = points[i-1].clone().sub(points[i-2]);
            changes.push(v1.angleTo(v2));
        }
        return {
            angles: changes,
            average: changes.reduce((a, b) => a + b, 0) / changes.length,
            variance: this.calculateVariance(changes)
        };
    }

    analyzeStepPattern(points) {
        const steps = [];
        for (let i = 1; i < points.length; i++) {
            steps.push(points[i].distanceTo(points[i-1]));
        }
        return {
            steps: steps,
            average: steps.reduce((a, b) => a + b, 0) / steps.length,
            variance: this.calculateVariance(steps)
        };
    }

    analyzeLocalContext(points) {
        const positions = tokenCloud.geometry.attributes.position;
        const weights = tokenCloud.geometry.attributes.weight;
        const lastPoint = points[points.length - 1];
        
        // Analyze nearby token weights
        const nearbyWeights = [];
        const maxInfluence = 2.0;
        
        for (let i = 0; i < positions.array.length; i += 3) {
            const tokenPos = new THREE.Vector3(
                positions.array[i],
                positions.array[i + 1],
                positions.array[i + 2]
            );
            const distance = lastPoint.distanceTo(tokenPos);
            if (distance < maxInfluence) {
                nearbyWeights.push({
                    weight: weights.array[i / 3],
                    distance: distance
                });
            }
        }
        
        return {
            weights: nearbyWeights,
            averageWeight: nearbyWeights.reduce((acc, w) => acc + w.weight, 0) / nearbyWeights.length,
            weightGradient: this.calculateWeightGradient(nearbyWeights)
        };
    }

    calculateVariance(values) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        return values.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / values.length;
    }

    calculateWeightGradient(weights) {
        // Calculate the direction of increasing weights
        return weights.reduce((acc, w) => acc + w.weight / (1 + w.distance), 0);
    }

    applyPatterns(currentPoint, patterns) {
        // Combine all pattern influences
        const direction = new THREE.Vector3();
        
        // Apply direction changes
        if (this.lastDirection) {
            direction.copy(this.lastDirection);
            // Use direction pattern's average angle
            if (patterns.direction && patterns.direction.average) {
                direction.applyAxisAngle(
                    new THREE.Vector3(0, 1, 0),
                    patterns.direction.average
                );
            }
        } else {
            // Initial direction
            direction.set(
                Math.random() - 0.5,
                Math.random() - 0.5,
                Math.random() - 0.5
            ).normalize();
        }
        
        // Apply step pattern
        const stepSize = patterns.steps ? patterns.steps.average : 0.15;
        
        // Apply local context influence
        const contextInfluence = patterns.context ? patterns.context.weightGradient : 0;
        
        // Combine and normalize
        direction.normalize().multiplyScalar(stepSize);
        
        // Store for next iteration
        this.lastDirection = direction.clone();
        
        return currentPoint.clone().add(direction);
    }
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

// Add animate function
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// Add window resize handler
window.addEventListener('resize', onWindowResize, false);

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

console.log('Starting initialization');
init();

function createTokenCloud() {
    console.log('Creating token cloud...');
    try {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const colors = [];
        const weights = [];

        const resolution = 50;
        const size = 8;
        const noiseScale = 0.2;

        for (let i = 0; i < resolution; i++) {
            for (let j = 0; j < resolution; j++) {
                for (let k = 0; k < resolution; k++) {
                    const x = (i / resolution - 0.5) * size;
                    const y = (j / resolution - 0.5) * size;
                    const z = (k / resolution - 0.5) * size;

                    const elevation = Math.sin(x * noiseScale) * Math.cos(z * noiseScale) +
                                    Math.sin(y * noiseScale * 2) * 0.5 +
                                    Math.cos((x + z) * noiseScale * 0.5) * 0.3;
                    
                    const weight = Math.max(0, (elevation + 1) / 2);

                    if (weight > 0.3) {
                        positions.push(x, y, z);
                        weights.push(weight);
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
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

function moveCamera(position) {
    gsap.to(camera.position, {
        x: position.x,
        y: position.y,
        z: position.z,
        duration: 1.2,
        ease: "power2.inOut",
        onUpdate: () => camera.lookAt(0, 0, 0)
    });
}