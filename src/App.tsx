import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PointerLockControls, PerspectiveCamera, Stars, Environment, Text, Float } from '@react-three/drei';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import { Ghost, Trophy, Skull, Play, RotateCcw, ArrowRight } from 'lucide-react';

// --- TYPES & CONSTANTS ---
const CELL_SIZE = 4;
const WALL_HEIGHT = 5;

type Cell = {
  x: number;
  y: number;
  walls: { top: boolean; right: boolean; bottom: boolean; left: boolean };
  visited: boolean;
};

// --- MAZE GENERATOR ---
function generateMaze(width: number, height: number): Cell[][] {
  const grid: Cell[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < width; x++) {
      row.push({
        x,
        y,
        walls: { top: true, right: true, bottom: true, left: true },
        visited: false,
      });
    }
    grid.push(row);
  }

  const stack: Cell[] = [];
  const startCell = grid[0][0];
  startCell.visited = true;
  stack.push(startCell);

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbors: [Cell, string][] = [];

    const { x, y } = current;
    if (y > 0 && !grid[y - 1][x].visited) neighbors.push([grid[y - 1][x], 'top']);
    if (x < width - 1 && !grid[y][x + 1].visited) neighbors.push([grid[y][x + 1], 'right']);
    if (y < height - 1 && !grid[y + 1][x].visited) neighbors.push([grid[y + 1][x], 'bottom']);
    if (x > 0 && !grid[y][x - 1].visited) neighbors.push([grid[y][x - 1], 'left']);

    if (neighbors.length > 0) {
      const [next, direction] = neighbors[Math.floor(Math.random() * neighbors.length)];
      if (direction === 'top') {
        current.walls.top = false;
        next.walls.bottom = false;
      } else if (direction === 'right') {
        current.walls.right = false;
        next.walls.left = false;
      } else if (direction === 'bottom') {
        current.walls.bottom = false;
        next.walls.top = false;
      } else if (direction === 'left') {
        current.walls.left = false;
        next.walls.right = false;
      }
      next.visited = true;
      stack.push(next);
    } else {
      stack.pop();
    }
  }

  return grid;
}

// --- COMPONENTS ---

const Wall = ({ position, rotation, scale, color }: any) => (
  <mesh position={position} rotation={rotation}>
    <boxGeometry args={scale} />
    <meshStandardMaterial 
      color={color} 
      emissive={color} 
      emissiveIntensity={0.5}
      roughness={0.2}
      metalness={0.8}
    />
  </mesh>
);

const Enemy = ({ 
  playerPos, 
  mazeSize, 
  mazeGrid,
  onCatch, 
  active, 
  onProximityChange,
  level,
  spawnPos
}: { 
  playerPos: THREE.Vector3, 
  mazeSize: number, 
  mazeGrid: Cell[][],
  onCatch: () => void, 
  active: boolean,
  onProximityChange: (isClose: boolean) => void,
  level: number,
  spawnPos: [number, number, number]
}) => {
  const meshRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const shardsRef = useRef<THREE.Group>(null);
  const nextWaypoint = useRef<THREE.Vector3 | null>(null);
  const lastPathUpdate = useRef(0);
  const isChasing = useRef(false);
  
  // Initialize position to spawnPos
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.position.set(...spawnPos);
    }
  }, [spawnPos]);

  // Stalking speed: Scales with level
  const baseSpeed = 1.0 + (level * 0.4) + (mazeSize / 10); 
  
  // Helper to check for a straight line of sight through corridors
  const checkLineOfSight = (ePos: THREE.Vector3, pPos: THREE.Vector3, grid: Cell[][]): boolean => {
    const ex = Math.round(ePos.x / CELL_SIZE);
    const ey = Math.round(ePos.z / CELL_SIZE);
    const px = Math.round(pPos.x / CELL_SIZE);
    const py = Math.round(pPos.z / CELL_SIZE);

    if (ex !== px && ey !== py) return false; 

    if (ex === px) { // Same column
      const startY = Math.min(ey, py);
      const endY = Math.max(ey, py);
      for (let y = startY; y < endY; y++) {
        const cell = grid[y]?.[ex];
        if (!cell || (y < py ? cell.walls.bottom : cell.walls.top)) return false;
      }
      return true;
    } else { // Same row
      const startX = Math.min(ex, px);
      const endX = Math.max(ex, px);
      for (let x = startX; x < endX; x++) {
        const cell = grid[ey]?.[x];
        if (!cell || (x < px ? cell.walls.right : cell.walls.left)) return false;
      }
      return true;
    }
  };

  useFrame((state, delta) => {
    if (!meshRef.current || !active) return;
    
    const now = state.clock.getElapsedTime();
    const hasLoS = checkLineOfSight(meshRef.current.position, playerPos, mazeGrid);
    isChasing.current = hasLoS;

    // Movement speed boost when in sight
    const speed = (hasLoS ? baseSpeed * 1.8 : baseSpeed) * delta;

    // Update pathfinding logic
    if (now - lastPathUpdate.current > (hasLoS ? 0.1 : 0.4) || !nextWaypoint.current) {
      lastPathUpdate.current = now;
      
      const ex = Math.round(meshRef.current.position.x / CELL_SIZE);
      const ey = Math.round(meshRef.current.position.z / CELL_SIZE);
      const px = Math.round(playerPos.x / CELL_SIZE);
      const py = Math.round(playerPos.z / CELL_SIZE);

      if (ex === px && ey === py) {
         nextWaypoint.current = playerPos.clone();
      } else {
        // BFS to find the path towards the player
        const queue: [number, number, [number, number][]][] = [[ex, ey, []]];
        const visited = new Set();
        visited.add(`${ex},${ey}`);
        
        let nextCell: [number, number] | null = null;
        while (queue.length > 0) {
          const [cx, cy, path] = queue.shift()!;
          if (cx === px && cy === py) {
            nextCell = path[0] || [px, py];
            break;
          }
          const cell = mazeGrid[cy]?.[cx];
          if (!cell) continue;
          const neighbors: [number, number][] = [];
          if (!cell.walls.top) neighbors.push([cx, cy - 1]);
          if (!cell.walls.bottom) neighbors.push([cx, cy + 1]);
          if (!cell.walls.left) neighbors.push([cx - 1, cy]);
          if (!cell.walls.right) neighbors.push([cx + 1, cy]);
          for (const [nx, ny] of neighbors) {
            if (!visited.has(`${nx},${ny}`)) {
              visited.add(`${nx},${ny}`);
              queue.push([nx, ny, [...path, [nx, ny]]]);
            }
          }
        }
        if (nextCell) {
          nextWaypoint.current = new THREE.Vector3(nextCell[0] * CELL_SIZE, 1, nextCell[1] * CELL_SIZE);
        }
      }
    }

    // Move towards waypoint or player
    const target = hasLoS ? playerPos.clone() : (nextWaypoint.current || playerPos.clone());
    const moveDir = target.sub(meshRef.current.position);
    moveDir.y = 0;
    
    if (moveDir.length() > 0.05) {
      moveDir.normalize();
      meshRef.current.position.addScaledVector(moveDir, speed);
    }
    meshRef.current.lookAt(playerPos.x, meshRef.current.position.y, playerPos.z);

    // Animations for the monster
    if (coreRef.current) coreRef.current.rotation.y += delta * (hasLoS ? 6 : 2);
    if (shardsRef.current) shardsRef.current.rotation.z += delta * (hasLoS ? 5 : 1.5);

    const dist = meshRef.current.position.distanceTo(playerPos);
    
    // Proximity logic: warn when close
    onProximityChange(dist < 9);

    // Fatal collision
    if (dist < 1.4) {
      onCatch();
    }
  });


  return (
    <group ref={meshRef}>
      <Float speed={2} rotationIntensity={1} floatIntensity={1}>
        {/* Monster Core: A large dark mass */}
        <mesh ref={coreRef}>
          <octahedronGeometry args={[1.5, 2]} />
          <meshStandardMaterial color="#000000" metalness={1} roughness={0} />
          {/* Glowing Eye */}
          <mesh position={[0, 0.2, 1.0]}>
            <sphereGeometry args={[0.35, 16, 16]} />
            <meshStandardMaterial color="#ff0044" emissive="#ff0044" emissiveIntensity={15} />
          </mesh>
        </mesh>

        {/* Orbiting Shards: Make it look 'jagged' and 'spiky' */}
        <group ref={shardsRef}>
          {[...Array(8)].map((_, i) => (
            <mesh key={i} position={[
              Math.cos(i * (Math.PI / 4)) * 2.2,
              Math.sin(i * (Math.PI / 4)) * 1.5,
              Math.sin(i * (Math.PI / 4)) * 0.5
            ]} rotation={[Math.random(), Math.random(), Math.random()]}>
              <coneGeometry args={[0.25, 1.2, 4]} />
              <meshStandardMaterial color="#110000" emissive="#ff0000" emissiveIntensity={0.8} />
            </mesh>
          ))}
        </group>
        
        <pointLight color="#ff0000" intensity={15} distance={15} />
      </Float>
    </group>
  );
};

const Gate = ({ position, onReach, onPromptChange }: { position: [number, number, number], onReach: () => void, onPromptChange: (show: boolean) => void }) => {
  const playerInZone = useRef(false);

  useFrame((state) => {
    const dist = state.camera.position.distanceTo(new THREE.Vector3(...position));
    if (dist < 2.5) {
      if (!playerInZone.current) {
        playerInZone.current = true;
        onPromptChange(true);
      }
    } else {
      if (playerInZone.current) {
        playerInZone.current = false;
        onPromptChange(false);
      }
    }
  });

  return (
    <group position={position}>
      <mesh position={[0, WALL_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[1.2, 1.2, 0.2, 32]} />
        <meshStandardMaterial color="#00ffcc" emissive="#00ffcc" emissiveIntensity={5} />
      </mesh>
      <pointLight color="#00ffcc" intensity={15} distance={20} />
      <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
         <mesh position={[0, WALL_HEIGHT / 2 + 1, 0]}>
            <torusGeometry args={[0.8, 0.1, 16, 100]} />
            <meshStandardMaterial color="#00ffcc" emissive="#00ffcc" />
         </mesh>
      </Float>
    </group>
  );
};

const Player = ({ mazeGrid, onDie, onInteract, spawnPos }: { mazeGrid: Cell[][], onDie: () => void, onInteract: () => void, spawnPos: [number, number, number] }) => {
  const [keys, setKeys] = useState<{ [key: string]: boolean }>({});
  const velocity = useRef(new THREE.Vector3());
  const canJump = useRef(true);
  const initialized = useRef(false);

  // Initialize camera position only once when spawnPos changes
  useEffect(() => {
    initialized.current = false;
  }, [spawnPos]);

  useEffect(() => {
    const handleDown = (e: KeyboardEvent) => {
      setKeys(k => ({ ...k, [e.code]: true }));
      if (e.code === 'KeyE') onInteract();
    };
    const handleUp = (e: KeyboardEvent) => setKeys(k => ({ ...k, [e.code]: false }));
    window.addEventListener('keydown', handleDown);
    window.addEventListener('keyup', handleUp);
    return () => {
      window.removeEventListener('keydown', handleDown);
      window.removeEventListener('keyup', handleUp);
    };
  }, [onInteract]);

  useFrame((state, delta) => {
    const { camera } = state;

    // Set initial position once per level
    if (!initialized.current) {
      camera.position.set(...spawnPos);
      initialized.current = true;
      return;
    }

    // Walking feels: more responsive human pace
    const walkSpeed = (keys['ShiftLeft'] ? 2.8 : 1.5) * delta;
    const friction = 0.75;

    // Directional vectors relative to camera rotation
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    forward.y = 0; // Lock movement to horizontal plane
    right.y = 0;
    forward.normalize();
    right.normalize();

    // Key input processing
    const input = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp']) input.add(forward);
    if (keys['KeyS'] || keys['ArrowDown']) input.add(forward.clone().negate());
    if (keys['KeyA'] || keys['ArrowLeft']) input.add(right.clone().negate());
    if (keys['KeyD'] || keys['ArrowRight']) input.add(right);

    const isMoving = input.length() > 0;
    if (isMoving) {
      input.normalize().multiplyScalar(walkSpeed);
      velocity.current.add(input);
    }

    // Jump logic
    if (keys['Space'] && canJump.current) {
      velocity.current.y = 0.15; // Lower jump for realism
      canJump.current = false;
    }

    // Apply Velocity & Physics
    camera.position.x += velocity.current.x;
    camera.position.z += velocity.current.z;
    camera.position.y += velocity.current.y;

    velocity.current.x *= friction;
    velocity.current.z *= friction;

    // Gravity and Grounding
    const baseHeight = 1.6;
    if (camera.position.y > baseHeight) {
      velocity.current.y -= 0.008;
    } else {
      camera.position.y = baseHeight;
      velocity.current.y = 0;
      canJump.current = true;
    }

    // Collision detection logic
    const gx = Math.floor((camera.position.x + (CELL_SIZE / 2)) / CELL_SIZE);
    const gz = Math.floor((camera.position.z + (CELL_SIZE / 2)) / CELL_SIZE);
    
    const cell = mazeGrid[gz]?.[gx];
    if (cell) {
       const lx = (state.camera.position.x + (CELL_SIZE / 2)) % CELL_SIZE;
       const lz = (state.camera.position.z + (CELL_SIZE / 2)) % CELL_SIZE;
       const margin = 0.65; 

       if (cell.walls.top && lz < margin) {
         state.camera.position.z = gz * CELL_SIZE - (CELL_SIZE / 2) + margin;
         velocity.current.z = 0;
       }
       if (cell.walls.bottom && lz > CELL_SIZE - margin) {
         state.camera.position.z = gz * CELL_SIZE + (CELL_SIZE / 2) - margin;
         velocity.current.z = 0;
       }
       if (cell.walls.left && lx < margin) {
         state.camera.position.x = gx * CELL_SIZE - (CELL_SIZE / 2) + margin;
         velocity.current.x = 0;
       }
       if (cell.walls.right && lx > CELL_SIZE - margin) {
         state.camera.position.x = gx * CELL_SIZE + (CELL_SIZE / 2) - margin;
         velocity.current.x = 0;
       }
    }
  });

  return <PointerLockControls />;
};

// --- MAIN APP ---

export default function App() {
  const [level, setLevel] = useState(1);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'win' | 'gameover'>('menu');
  const [enemyActive, setEnemyActive] = useState(false);
  const [enemyClose, setEnemyClose] = useState(false);
  const [showGatePrompt, setShowGatePrompt] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [mazeSize, setMazeSize] = useState(5);
  const [maze, setMaze] = useState<Cell[][]>([]);
  const [spawnPos, setSpawnPos] = useState<[number, number, number]>([0, 1.6, 0]);
  const [enemySpawnPos, setEnemySpawnPos] = useState<[number, number, number]>([0, 1, 0]);
  const [exitPos, setExitPos] = useState<[number, number, number]>([0, 0, 0]);
  const playerPosRef = useRef(new THREE.Vector3());

  const startGame = () => {
    const size = 5 + level * 2;
    const newMaze = generateMaze(size, size);
    setMaze(newMaze);
    setMazeSize(size);
    setShowGatePrompt(false);
    
    // Get random floor position for player
    const px = Math.floor(Math.random() * size);
    const py = Math.floor(Math.random() * size);
    setSpawnPos([px * CELL_SIZE, 1.6, py * CELL_SIZE]);
    
    // Exit gate usually at opposite end
    const lastX = size - 1;
    const lastY = size - 1;
    setExitPos([lastX * CELL_SIZE, 0, lastY * CELL_SIZE]);

    // Enemy spawn: Find a spot far from player
    let ex, ey;
    do {
      ex = Math.floor(Math.random() * size);
      ey = Math.floor(Math.random() * size);
    } while (Math.sqrt(Math.pow(ex - px, 2) + Math.pow(ey - py, 2)) < size / 2);
    setEnemySpawnPos([ex * CELL_SIZE, 1, ey * CELL_SIZE]);

    setGameState('playing');
    setEnemyActive(false);
    setCountdown(3);
  };

  const attemptExit = () => {
    if (showGatePrompt) {
      nextLevel();
    }
  };

  useEffect(() => {
    let timer: any;
    if (gameState === 'playing' && !enemyActive && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            setEnemyActive(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [gameState, enemyActive]);

  const nextLevel = () => {
    setLevel(l => l + 1);
    setGameState('win');
  };

  const gameOver = () => {
    setGameState('gameover');
  };

  const walls = useMemo(() => {
    const elements: any[] = [];
    maze.forEach((row, y) => {
      row.forEach((cell, x) => {
        const px = x * CELL_SIZE;
        const pz = y * CELL_SIZE;
        const color = level % 2 === 0 ? "#ff00ff" : "#00ffff";

        if (cell.walls.top) {
          elements.push(
            <Wall key={`t-${x}-${y}`} position={[px, WALL_HEIGHT / 2, pz - CELL_SIZE / 2]} scale={[CELL_SIZE, WALL_HEIGHT, 0.2]} color={color} />
          );
        }
        if (cell.walls.bottom && y === mazeSize - 1) {
          elements.push(
             <Wall key={`b-${x}-${y}`} position={[px, WALL_HEIGHT / 2, pz + CELL_SIZE / 2]} scale={[CELL_SIZE, WALL_HEIGHT, 0.2]} color={color} />
          );
        }
        if (cell.walls.left) {
          elements.push(
            <Wall key={`l-${x}-${y}`} position={[px - CELL_SIZE / 2, WALL_HEIGHT / 2, pz]} scale={[0.2, WALL_HEIGHT, CELL_SIZE]} color={color} />
          );
        }
        if (cell.walls.right && x === mazeSize - 1) {
          elements.push(
            <Wall key={`r-${x}-${y}`} position={[px + CELL_SIZE / 2, WALL_HEIGHT / 2, pz]} scale={[0.2, WALL_HEIGHT, CELL_SIZE]} color={color} />
          );
        }
      });
    });
    return elements;
  }, [maze, level]);

  return (
    <div id="game-container" className="w-full h-screen bg-black overflow-hidden font-sans text-white">
      {/* UI OVERLAYS */}
      <AnimatePresence>
        {gameState === 'menu' && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
          >
            <h1 className="text-8xl font-black mb-4 tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-cyan-400 to-blue-600">
              NEON LABYRINTH
            </h1>
            <p className="text-xl mb-12 opacity-60 font-mono tracking-widest uppercase">Outrun the Void • Reach the Gate</p>
            <button 
              onClick={startGame}
              className="group flex flex-col items-center gap-4 transition-all"
            >
              <div className="w-24 h-24 rounded-full border-2 border-cyan-400 flex items-center justify-center group-hover:bg-cyan-400 group-hover:scale-110 transition-all duration-300">
                <Play className="w-10 h-10 fill-white text-white group-hover:scale-110" />
              </div>
              <span className="text-sm font-semibold tracking-[0.3em] text-cyan-400 uppercase">Commence</span>
            </button>
            <div className="mt-12 text-xs text-cyan-400/50 flex gap-12 font-mono uppercase">
              <span>[WASD] MOVE</span>
              <span>[MOUSE] LOOK</span>
              <span>[ESC] MENU</span>
            </div>
          </motion.div>
        )}

        {gameState === 'gameover' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-red-950/90 backdrop-blur-md"
          >
            <Skull className="w-24 h-24 text-red-500 mb-8" />
            <h2 className="text-6xl font-black mb-2 text-white">CAPTURED</h2>
            <p className="text-xl mb-12 text-red-400/80 font-mono uppercase italic">The void has claimed another soul.</p>
            <button 
              onClick={() => { setLevel(1); startGame(); }}
              className="px-12 py-4 bg-white text-black font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-colors"
            >
              Restart Cycle
            </button>
          </motion.div>
        )}

        {gameState === 'win' && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-cyan-950/90 backdrop-blur-md"
          >
            <Trophy className="w-24 h-24 text-cyan-400 mb-8" />
            <h2 className="text-6xl font-black mb-2 text-white italic">LEVEL {level-1} CLEAR</h2>
            <p className="text-xl mb-12 text-cyan-300 font-mono uppercase tracking-widest">Complexity Threshold Increasing...</p>
            <button 
              onClick={startGame}
              className="group relative px-16 py-6 border-2 border-cyan-400 overflow-hidden transition-all duration-500"
            >
               <div className="absolute inset-0 bg-cyan-400 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
               <span className="relative z-10 flex items-center gap-4 text-xl font-black text-white group-hover:text-black uppercase">
                 Enter Level {level} <ArrowRight />
               </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HUD */}
      {gameState === 'playing' && (
        <>
          {countdown > 0 && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 2 }}
              key={countdown}
              className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
            >
              <div className="flex flex-col items-center">
                <span className="text-9xl font-black text-cyan-400 drop-shadow-[0_0_30px_rgba(34,211,238,0.5)]">
                  {countdown}
                </span>
                <span className="text-xl font-mono tracking-[0.5em] text-cyan-400/50 uppercase mt-4">
                  Stabilizing Reality
                </span>
              </div>
            </motion.div>
          )}

          <div className="absolute top-0 left-0 w-full p-8 z-40 pointer-events-none flex justify-between items-start">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-[0.2em] opacity-40">System Navigation</span>
                <div className="flex flex-col font-mono text-[11px] text-white/70 gap-1 uppercase tracking-wider">
                  <div className="flex gap-4">
                    <span className="text-cyan-400 w-12">[WASD]</span>
                    <span>Translate</span>
                  </div>
                  <div className="flex gap-4">
                    <span className="text-cyan-400 w-12">[E]</span>
                    <span>Interact / Exit</span>
                  </div>
                  <div className="flex gap-4">
                    <span className="text-cyan-400 w-12">[SPACE]</span>
                    <span>Elevate</span>
                  </div>
                  <div className="flex gap-4">
                    <span className="text-cyan-400 w-12">[MOUSE]</span>
                    <span>Orient Look</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-mono text-cyan-400 uppercase tracking-widest opacity-50">Operational Phase</span>
                <span className="text-4xl font-black italic">LVL {level}</span>
              </div>
            </div>
            
            {showGatePrompt && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                <div className="bg-cyan-400 text-black px-6 py-2 font-black italic tracking-tighter text-2xl animate-pulse">
                  [E] TO BREACH EXIT GATE
                </div>
              </motion.div>
            )}
            {enemyClose && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                <div className="flex flex-col items-center">
                  <div className="bg-red-600/90 text-white px-8 py-4 font-black italic tracking-tighter text-4xl shadow-[0_0_50px_rgba(220,38,38,0.5)] border-y-4 border-white animate-pulse">
                    ENEMY DETECTED
                  </div>
                  <span className="text-red-500 font-mono text-sm mt-4 tracking-[0.4em] uppercase font-bold text-shadow-glow">
                    Anomaly Proximity Critical
                  </span>
                </div>
              </motion.div>
            )}
            <div className="flex flex-col items-end gap-2">
              <span className="text-xs font-mono text-pink-500 uppercase tracking-widest opacity-50 text-right">Anomaly Proximity</span>
              <div className="w-48 h-1 bg-white/10 overflow-hidden">
                 <motion.div 
                   animate={{ 
                     width: enemyActive ? "100%" : "0%",
                     backgroundColor: enemyActive ? ["#ff3366", "#33ff66", "#ff3366"] : "#333"
                   }} 
                   transition={{ repeat: Infinity, duration: 2 }}
                   className="h-full bg-pink-500"
                 />
              </div>
              {enemyClose && (
                <motion.div 
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="mt-4 bg-red-600 text-white px-3 py-1 text-[10px] font-mono uppercase tracking-[0.3em] font-bold animate-pulse"
                >
                  Anomaly is Close
                </motion.div>
              )}
            </div>
          </div>
        </>
      )}

      {/* 3D WORLD */}
      <Canvas shadows>
        <PerspectiveCamera makeDefault position={spawnPos} fov={75} />
        {gameState === 'playing' && (
          <Player mazeGrid={maze} onDie={gameOver} onInteract={attemptExit} spawnPos={spawnPos} />
        )}
        
        <ambientLight intensity={0.2} />
        <spotLight position={[0, 20, 0]} intensity={200} angle={Math.PI / 4} penumbra={1} castShadow />
        <Environment preset="night" />
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
        
        {/* FLOOR - Enclosed */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ (mazeSize * CELL_SIZE) / 2 - (CELL_SIZE/2), -0.01, (mazeSize * CELL_SIZE) / 2 - (CELL_SIZE/2)]}>
          <planeGeometry args={[mazeSize * CELL_SIZE * 2, mazeSize * CELL_SIZE * 2]} />
          <meshStandardMaterial color="#080808" roughness={0.1} metalness={0.9} />
          <gridHelper args={[mazeSize * CELL_SIZE * 2, mazeSize, 0x00ffff, 0x001111]} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.02]} />
        </mesh>

        {/* CEILING */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[ (mazeSize * CELL_SIZE) / 2 - (CELL_SIZE/2), WALL_HEIGHT, (mazeSize * CELL_SIZE) / 2 - (CELL_SIZE/2)]}>
          <planeGeometry args={[mazeSize * CELL_SIZE * 2, mazeSize * CELL_SIZE * 2]} />
          <meshStandardMaterial color="#020202" roughness={0.5} metalness={0.5} />
          {/* Subtle grid on ceiling */}
          <gridHelper args={[mazeSize * CELL_SIZE * 2, mazeSize, 0x00ffff, 0x002222]} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.01]} />
        </mesh>

        {/* MAZE WALLS */}
        <group>
          {walls}
        </group>

        {/* EXIT GATE */}
        {gameState === 'playing' && (
          <Gate position={exitPos} onReach={nextLevel} onPromptChange={setShowGatePrompt} />
        )}

        {/* ENEMY */}
        {gameState === 'playing' && (
          <Enemy 
            playerPos={playerPosRef.current} 
            mazeSize={mazeSize} 
            mazeGrid={maze}
            onCatch={gameOver} 
            active={enemyActive}
            onProximityChange={setEnemyClose}
            level={level}
            spawnPos={enemySpawnPos}
          />
        )}

        <Updater onUpdate={(pos: THREE.Vector3) => playerPosRef.current.copy(pos)} />
      </Canvas>
      
      {/* SCANLINE EFFECT */}
      <div className="fixed inset-0 pointer-events-none z-10 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%] opacity-20" />
    </div>
  );
}

// Helper to bridge camera position to enemy follow logic
function Updater({ onUpdate }: { onUpdate: (pos: THREE.Vector3) => void }) {
  useFrame(({ camera }) => {
    onUpdate(camera.position);
  });
  return null;
}
