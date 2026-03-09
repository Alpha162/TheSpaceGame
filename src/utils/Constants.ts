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
export const ENEMY_ATTACK_COOLDOWN = 1500; // ms between attacks
export const ENEMY_ATTACK_RANGE = 25;     // range at which enemy attacks
export const ENEMY_MINERAL_REWARD = 10;   // minerals dropped on death

// Node repair constants
export const NODE_REPAIR_DELAY_MS = 3000;    // ms after last damage before repair starts
export const NODE_REPAIR_RATE = 0.02;        // health per ms (= 20 HP/sec)
export const NODE_REPAIR_POWER_COST = 3;     // extra power per tick while repairing
