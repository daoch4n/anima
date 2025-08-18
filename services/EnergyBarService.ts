import { createComponentLogger } from "@services/DebugLogger";

export type STSEnergyLevel = 0 | 1 | 2 | 3;
export type TTSEnergyLevel = 0 | 1 | 2;
export type EnergyLevel = STSEnergyLevel | TTSEnergyLevel;
export type EnergyMode = "sts" | "tts";

export interface EnergyState {
  level: EnergyLevel;
  modelTier: string | null;
}

export type EnergyResetReason =
  | "rate-limit-exceeded"
  | "session-reset"
  | "manual";

export interface EnergyLevelChangedDetail extends EnergyState {
  reason: EnergyResetReason;
  prevLevel: EnergyLevel;
  mode: EnergyMode;
}

const logger = createComponentLogger("energy-bar-system");

// Mapping based on design spec (STS)
const STS_MODEL_TIER_BY_LEVEL: Record<STSEnergyLevel, string | null> = {
  3: "gemini-2.5-flash-exp-native-audio-thinking-dialog",
  2: "gemini-2.5-flash-preview-native-audio-dialog",
  1: "gemini-2.5-flash-live-preview",
  0: null,
};

// TTS mapping: simplified 3-level system with fallback model at level 1
const TTS_MODEL_TIER_BY_LEVEL: Record<TTSEnergyLevel, string | null> = {
  2: "gemini-live-2.5-flash-preview", // Primary stable model
  1: "gemini-2.0-flash-live-001", // Fallback model for degraded performance
  0: null, // Exhausted state
};

/**
 * Singleton service managing the Energy Bar state for both STS and TTS modes.
 * Emits `energy-level-changed` CustomEvent<EnergyLevelChangedDetail> on changes.
 */
export class EnergyBarService extends EventTarget {
  private static _instance: EnergyBarService | null = null;
  private _levels: Record<EnergyMode, EnergyLevel> = { sts: 3, tts: 2 };

  static get instance(): EnergyBarService {
    if (!EnergyBarService._instance)
      EnergyBarService._instance = new EnergyBarService();
    return EnergyBarService._instance;
  }

  /** Get the current energy level (0..3) for a mode. */
  getCurrentEnergyLevel(mode: EnergyMode = "sts"): EnergyLevel {
    return this._levels[mode];
  }

  /** Get the current model name for the mode and active level, or null if exhausted. */
  getCurrentModel(mode: EnergyMode = "sts"): string | null {
    return this.getModelForLevel(this._levels[mode], mode);
  }

  /** Get the model name for a specific level and mode. */
  getModelForLevel(
    level: EnergyLevel,
    mode: EnergyMode = "sts",
  ): string | null {
    if (mode === "sts") {
      return STS_MODEL_TIER_BY_LEVEL[level as STSEnergyLevel];
    } else {
      return TTS_MODEL_TIER_BY_LEVEL[level as TTSEnergyLevel];
    }
  }
  /**
   * Determines if affective dialog should be enabled based on STS energy level.
   * Affective dialog is enabled for STS energy levels 2 and 3.
   * @returns {boolean} True if affective dialog should be enabled, otherwise false.
   */
  isAffectiveDialogEnabled(): boolean {
    const stsLevel = this.getCurrentEnergyLevel("sts") as STSEnergyLevel;
    return stsLevel === 3 || stsLevel === 2;
  }

  /** Decrement energy level by 1 due to a rate limit error for a specific mode, logging and emitting change events. */
  handleRateLimitError(mode: EnergyMode = "sts"): void {
    const prev = this._levels[mode];
    const next = Math.max(0, prev - 1) as EnergyLevel;
    if (next === prev) return;

    this._levels[mode] = next;
    const detail: EnergyLevelChangedDetail = {
      mode,
      level: this._levels[mode],
      modelTier: this.getCurrentModel(mode),
      prevLevel: prev,
      reason: "rate-limit-exceeded",
    };

    logger.debug("Energy level downgraded", detail);
    this.dispatchEvent(
      new CustomEvent<EnergyLevelChangedDetail>("energy-level-changed", {
        detail,
      }),
    );
  }

  /** Reset the energy level to maximum for a mode and emit a change event. */
  resetEnergyLevel(
    reason: EnergyLevelChangedDetail["reason"] = "session-reset",
    mode: EnergyMode = "sts",
  ): void {
    const prev = this._levels[mode];
    const maxLevel = mode === "sts" ? 3 : 2; // STS max: 3, TTS max: 2
    if (prev === maxLevel) return;

    this._levels[mode] = maxLevel as EnergyLevel;
    const detail: EnergyLevelChangedDetail = {
      mode,
      level: this._levels[mode],
      modelTier: this.getCurrentModel(mode),
      prevLevel: prev,
      reason,
    };
    logger.debug("Energy level reset", detail);
    this.dispatchEvent(
      new CustomEvent<EnergyLevelChangedDetail>("energy-level-changed", {
        detail,
      }),
    );
  }

  /** Set the energy level manually (clamped to mode-specific range) for a mode. */
  setEnergyLevel(
    level: number,
    reason: EnergyLevelChangedDetail["reason"] = "manual",
    mode: EnergyMode = "sts",
  ): void {
    const maxLevel = mode === "sts" ? 3 : 2; // STS max: 3, TTS max: 2
    const clamped = Math.max(
      0,
      Math.min(maxLevel, Math.floor(level)),
    ) as EnergyLevel;
    const prev = this._levels[mode];
    if (clamped === prev) return;

    this._levels[mode] = clamped;
    const detail: EnergyLevelChangedDetail = {
      mode,
      level: this._levels[mode],
      modelTier: this.getCurrentModel(mode),
      prevLevel: prev,
      reason,
    };

    logger.warn("Energy level changed manually", detail);
    this.dispatchEvent(
      new CustomEvent<EnergyLevelChangedDetail>("energy-level-changed", {
        detail,
      }),
    );
  }
}

export const energyBarService = EnergyBarService.instance;
