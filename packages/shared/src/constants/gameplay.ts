// Arena FPS gameplay constants — all distances in metres, times in milliseconds.
export const GAMEPLAY = {
  // ── Tick ──
  tickMs: 50,
  tickRate: 20, // 1000 / tickMs

  // ── Movement ──
  moveSpeed: 12,
  sprintMultiplier: 1.3,
  crouchMultiplier: 0.5,
  airControlFactor: 0.35,
  playerRadius: 0.4,
  playerHeight: 1.8,
  playerEyeHeight: 1.6,
  crouchHeight: 1.1,
  crouchEyeHeight: 0.9,

  // ── Jumping ──
  jumpSpeed: 7.5,
  gravity: 20,
  /** Repeated jumps within this window lose effectiveness. */
  bunnyHopWindowMs: 250,
  bunnyHopPenalty: 0.82,

  // ── Sliding ──
  slideSpeed: 16,
  slideDurationMs: 500,
  slideCooldownMs: 800,
  slideMinSpeedThreshold: 4,
  slideHeightMultiplier: 0.6,
  slideEyeHeight: 0.7,
  slideFriction: 0.92,
  slideIceBonus: 1.15,
  slideDownhillBonus: 1.1,

  // ── Surface friction ──
  groundFriction: 0.88,
  iceFriction: 0.97,
  waterSpeedPenalty: 0.7,
  waterControlFactor: 0.38,
  waterSurfaceY: 0,
  waterFloatDepth: 0.55,
  waterSwimDepth: 0.08,
  /** Feet depth while crouch/dive is held in deep Original World water. */
  originalWaterDiveDepth: 2.4,
  waterBuoyancy: 18,
  waterVerticalDrag: 6,
  waterMaxRiseSpeed: 3,
  waterMaxSinkSpeed: 2,
  waterEntryHeight: 0.18,

  spawnProtectionMs: 1500,

  // ── Network ──
  interpolationMs: 100,
  inputExpiryMs: 250,
  maxInputQueue: 5,

  // ── Match timing ──
  countdownMs: 3000,
  tdmTimeLimitMs: 300_000,
  /** Round timing is fixed at five minutes. Snow starts at the 1:00 gameplay mark (4:00 remaining). */
  snowStartRemainingMs: 240_000,
  /** Blizzard peaks with the heavy snowfall window and then fades the snow visually over 30 seconds. */
  blizzardStartRemainingMs: 120_000,
  intermissionMs: 8_000,
  warmupMs: 10_000,

  // ── Interaction ──
  interactionRange: 2,
  freezeProtectionMs: 2000,
  freezeKnockbackSpeed: 13,
  freezeKnockbackVerticalSpeed: 5.5,
  freezeKnockbackMs: 250,

  // ── Ice lunge ──
  lungeDurationMs: 600,
  lungeCooldownMs: 3000,
  lungeSpeedMultiplier: 2,
  lungeVerticalSpeed: 7.5,

  // ── Wall run ──
  wallRunGravityFactor: 0.18,
  wallRunJumpSpeed: 7.5,
  wallRunKickSpeed: 6,
  wallRunProbeDistance: 0.12,
} as const;
