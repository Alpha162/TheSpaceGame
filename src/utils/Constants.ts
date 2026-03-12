// World
export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 1800;
export const VIEWPORT_WIDTH = 800;
export const VIEWPORT_HEIGHT = 600;
export const CAMERA_SCROLL_SPEED = 8;
export const CAMERA_EDGE_ZONE = 32;
export const CAMERA_ZOOM_MIN = 0.4;
export const CAMERA_ZOOM_MAX = 2.0;
export const CAMERA_ZOOM_STEP = 0.1;

// Starfield
export const STAR_LAYER_COUNT = 3;
export const STARS_PER_LAYER = [200, 120, 60];
export const STAR_SIZES = [1, 1.5, 2.5];
export const STAR_ALPHAS = [0.3, 0.5, 0.8];
export const STAR_PARALLAX = [0.2, 0.5, 0.8];

// Command Hub
export const COMMAND_HUB_HEALTH = 500;
export const COMMAND_HUB_POWER_GEN = 100; // power generated per tick
export const COMMAND_HUB_RADIUS = 30;
export const COMMAND_HUB_SHIELD_RADIUS = 72; // built-in shield (~20% larger than normal)
export const COMMAND_HUB_SHIELD_POWER = 10;  // power cost to maintain hub shield
export const COMMAND_HUB_SHIELD_HEAT_DECAY = 0.004; // slightly faster recovery than normal

// Resources
export const STARTING_MINERALS = 300;

// Power
export const MAX_POWER_LINK_LENGTH = 200;
export const POWER_TICK_INTERVAL_MS = 500; // power economy updates every 500ms

// Power priority tiers
export enum PowerPriority {
    CRITICAL = 0,
    HIGH = 1,
    NORMAL = 2,
    LOW = 3
}

// Structure power consumption
export const BASIC_MINER_POWER = 5;
export const DEEP_MINER_POWER = 15;
export const STRIP_MINER_POWER = 10;
export const BLASTER_POWER = 8;
export const RAIL_POWER = 20;
export const MISSILE_POWER = 18;
export const TESLA_POWER = 25;
export const RELAY_POWER = 2;
export const REPAIR_BAY_POWER = 12;

// Shield constants
export const SHIELD_HEALTH = 80;
export const SHIELD_RADIUS = 14;
export const SHIELD_COST = 120;
export const SHIELD_POWER_DEPLOY = 20;   // power while bubble is expanding
export const SHIELD_POWER_MAINTAIN = 5;  // power to maintain deployed shield
export const SHIELD_BUBBLE_MAX_RADIUS = 60; // fully deployed bubble radius
export const SHIELD_DEPLOY_SPEED = 0.4;  // radius units per frame
export const SHIELD_HEAT_DECAY = 0.003;  // heat decay per frame (0..1)
export const SHIELD_COLLAPSE_COOLDOWN_MS = 5000; // cooldown after overheat collapse
export const SHIELD_ABSORB_HEAT_PER_DAMAGE = 0.1; // heat added per damage point
export const SHIELD_RESERVE_MAX = 1.0;   // internal energy reserve (0..1)
export const SHIELD_RESERVE_DRAIN_RATE = 0.00015;  // drain per ms (~7s of reserve idle)
export const SHIELD_RESERVE_FIRE_MULTIPLIER = 8;   // drains 8x faster under fire
export const SHIELD_RESERVE_CHARGE_RATE = 0.0004;  // charge per ms (~2.5s to fill when online)
export const SHIELD_CLUSTER_OVERLAP_MARGIN = 20;   // px of overlap forgiveness for cluster detection

// Cluster visual constants
export const COLOUR_CLUSTER_VIOLET = 0x9966ff;
export const CLUSTER_ARC_SEGMENTS = 24;
export const CLUSTER_ARC_AMPLITUDE = 12;
export const CLUSTER_ARC_SPEED = 2.5;
export const CLUSTER_MEMBRANE_MARGIN = 15;
export const CLUSTER_MEMBRANE_SAMPLES = 12;

// Relay connection limits
export const RELAY_MAX_CONNECTIONS = 4;    // max non-relay nodes per relay
export const HUB_MAX_CONNECTIONS = 6;      // max non-relay nodes hub can directly serve

// Capacitor constants
export const CAPACITOR_HEALTH = 60;
export const CAPACITOR_RADIUS = 11;
export const CAPACITOR_COST = 80;
export const CAPACITOR_POWER_CHARGE = 10; // max power absorbed per tick
export const CAPACITOR_MAX_STORAGE = 500; // max energy stored
export const CAPACITOR_DISCHARGE_RATE = 50; // max power released per tick

// Structure costs
export const RELAY_COST = 40;
export const BASIC_MINER_COST = 50;
export const BLASTER_COST = 75;
export const STRIP_MINER_COST = 150;
export const REPAIR_BAY_COST = 175;
export const DEEP_MINER_COST = 200;
export const RAIL_COST = 200;
export const MISSILE_COST = 250;
export const TESLA_COST = 300;

// Blaster turret constants
export const BLASTER_HEALTH = 60;
export const BLASTER_RADIUS = 11;
export const BLASTER_RANGE = 150;       // targeting range in world units
export const BLASTER_FIRE_RATE = 2;     // shots per second
export const BLASTER_DAMAGE = 8;        // per projectile
export const BLASTER_PROJECTILE_SPEED = 300; // world units per second

// Structure health
export const RELAY_HEALTH = 50;

// Node rendering
export const NODE_RADIUS = 12;
export const RELAY_RADIUS = 10;

// Colours
export const COLOUR_CYAN = 0x00e5ff;
export const COLOUR_CYAN_DIM = 0x006680;
export const COLOUR_AMBER = 0xffab00;
export const COLOUR_RED = 0xff3d00;
export const COLOUR_GREY = 0x444444;
export const COLOUR_DARK_METAL = 0x2a2a3a;
export const COLOUR_WHITE = 0xffffff;
export const COLOUR_BG = 0x0a0a1a;
export const COLOUR_PANEL = 0x1a1a2e;
export const COLOUR_PANEL_BORDER = 0x333355;
export const COLOUR_GREEN = 0x00ff88;
export const COLOUR_PURPLE = 0xaa44ff;

// Build phase
export const BUILD_PHASE_DURATION = 15;

// Node overlap check
export const MIN_NODE_DISTANCE = 30;

// Construction
export const CONSTRUCTION_TIME_MS = 10000;

// Selection
export const COLOUR_SELECTION = 0xffd700;

// Power flow
export const POWER_PULSE_SPEED = 0.003;

// Enemy constants
export const ENEMY_RADIUS = 6;
export const ENEMY_HEALTH = 30;
export const ENEMY_SPEED = 0.04;          // world units per ms
export const ENEMY_DAMAGE = 5;            // damage per hit
export const ENEMY_ATTACK_COOLDOWN = 2000; // ms between attacks
export const ENEMY_ATTACK_RANGE = 100;    // range at which enemy stops and fires
export const ENEMY_MINERAL_REWARD = 10;   // minerals dropped on death
export const ENEMY_PROJECTILE_SPEED = 180; // world units per second
export const ENEMY_THREAT_WEIGHT = 0.6;   // weight for preferring threat targets (0=nearest only, 1=threats only)

// Mineral Asteroid constants
export const ASTEROID_MINERALS = 500;     // total minerals per asteroid
export const ASTEROID_COUNT = 10;         // number spawned at game start
export const ASTEROID_RADIUS = 18;        // visual/collision radius
export const ASTEROID_MIN_HUB_DIST = 300; // minimum distance from hub center

// Mineral Miner constants
export const MINER_COST = 60;
export const MINER_HEALTH = 50;
export const MINER_RADIUS = 12;
export const MINER_POWER = 8;
export const MINER_RANGE = 80;            // must place within this range of an asteroid
export const MINER_RATE = 3;              // minerals extracted per tick
export const MINER_TICK_MS = 2000;        // ms between mining ticks

// Laser turret constants
export const LASER_COST = 80;
export const LASER_HEALTH = 60;
export const LASER_RADIUS = 13;
export const LASER_POWER = 15;
export const LASER_RANGE = 200;
export const LASER_DPS = 12;              // damage per second while beam is active
export const LASER_LOCK_TIME_MS = 500;    // ms to lock onto target before firing

// Missile turret constants (overrides earlier placeholders)
export const MISSILE_HEALTH = 70;
export const MISSILE_RADIUS = 14;
export const MISSILE_RANGE = 180;
export const MISSILE_DAMAGE = 15;
export const MISSILE_AOE_RADIUS = 40;
export const MISSILE_FIRE_RATE = 0.5;     // shots per second
export const MISSILE_PROJECTILE_SPEED = 120;

// Enemy type configs
export const SCOUT_HEALTH = 15;
export const SCOUT_SPEED = 0.08;
export const SCOUT_DAMAGE = 3;
export const SCOUT_RADIUS = 4;
export const SCOUT_REWARD = 5;

export const TANK_HEALTH = 100;
export const TANK_SPEED = 0.02;
export const TANK_DAMAGE = 10;
export const TANK_RADIUS = 10;
export const TANK_REWARD = 25;

export const SWARM_HEALTH = 10;
export const SWARM_SPEED = 0.06;
export const SWARM_DAMAGE = 2;
export const SWARM_RADIUS = 3;
export const SWARM_REWARD = 3;
export const SWARM_GROUP_SIZE = 4;        // spawned per "slot" in a wave

// Lancer Enemy
export const LANCER_HP = 20;
export const LANCER_SPEED = 0.05;
export const LANCER_BEAM_DPS = 8;
export const LANCER_BEAM_RANGE = 170;     // Inside missile (180) and laser (200) range, outside blaster (150)
export const LANCER_LOCK_TIME_MS = 400;
export const LANCER_REWARD = 15;
export const LANCER_RADIUS = 5;

// Tank Enemy Shield
export const TANK_SHIELD_RADIUS = 40;
export const TANK_SHIELD_HEAT_DECAY = 0.002;          // Slower decay than player shields (0.003) — tougher
export const TANK_SHIELD_HEAT_PER_DAMAGE = 0.08;      // Slightly less heat per hit than player (0.1) — tankier
export const TANK_SHIELD_COOLDOWN_MS = 6000;           // 6 seconds to redeploy after collapse

// Scout Enemy Shield
export const SCOUT_SHIELD_RADIUS = 20;
export const SCOUT_SHIELD_HEAT_PER_DAMAGE = 0.4;      // Very high — 2-3 hits collapses it
export const SCOUT_SHIELD_ONE_SHOT = true;             // Shield does not regenerate after collapse

// Upgrade constants
export const UPGRADE_COST_FRACTION = 0.7; // upgrade costs 70% of original build cost

// Colour for enemy types
export const COLOUR_SCOUT = 0x44ff88;     // green-ish
export const COLOUR_TANK = 0xaa44ff;      // purple
export const COLOUR_SWARM = 0xffdd00;     // yellow
export const COLOUR_LANCER = 0xff8800;    // amber/orange — distinct from player laser (cyan)

// UI scale factor (matches devicePixelRatio for crisp rendering)
export const UI_SCALE = window.devicePixelRatio || 1;

// Mineral pickup constants
export const MINERAL_PICKUP_TRACTOR_RANGE = 120;  // px — nodes pull pickups within this range
export const MINERAL_PICKUP_TRACTOR_SPEED = 0.15;  // world units per ms toward node
export const MINERAL_PICKUP_TRANSIT_SPEED = 0.2;   // world units per ms along power links
export const MINERAL_PICKUP_SCATTER_SPEED = 0.08;  // initial scatter velocity (units/ms)
export const MINERAL_PICKUP_FRICTION = 0.97;       // velocity damping per frame
export const MINERAL_PICKUP_LIFETIME = 15000;      // ms before uncollected pickup fades

// Node repair constants
export const NODE_REPAIR_DELAY_MS = 3000;    // ms after last damage before repair starts
export const NODE_REPAIR_RATE = 0.02;        // health per ms (= 20 HP/sec)
export const NODE_REPAIR_POWER_COST = 3;     // extra power per tick while repairing

// Speed control
export const SPEED_MULTIPLIER_OPTIONS = [2, 3, 5, 10]; // selectable target multipliers
export const SPEED_RAMP_RATE = 3.0;          // multiplier units ramped per second
