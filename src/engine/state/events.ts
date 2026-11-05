import type { AreaId, PowerId } from "../types.ts";

/**
 * Typed events emitted by the engine (mainly during combat and scoring) so the
 * UI can animate outcomes without re-deriving what happened. Presentation is
 * fully decoupled from rules.
 */
export type GameEvent =
  | {
      readonly type: "SPY_RESULT";
      readonly by: PowerId;
      readonly area: AreaId;
      readonly troops: number;
      readonly income: number;
    }
  | {
      readonly type: "SUBVERSION";
      readonly by: PowerId;
      readonly area: AreaId;
      readonly troopsRemoved: number;
      readonly coup: boolean;
    }
  | {
      readonly type: "BATTLE";
      readonly area: AreaId;
      readonly attacker: PowerId;
      readonly defender: PowerId | null;
      readonly attackerWon: boolean;
      readonly attackerLosses: number;
      readonly defenderLosses: number;
      /** Areas the attack set out from (several when armies converged). */
      readonly from: readonly AreaId[];
      readonly bySea: boolean;
    }
  | {
      readonly type: "CONTROL_CHANGE";
      readonly area: AreaId;
      readonly from: PowerId | null;
      readonly to: PowerId | null;
    }
  /** `by` attacked `against`; the two are now at war. */
  | {
      readonly type: "WAR_DECLARED";
      readonly by: PowerId;
      readonly against: PowerId;
    }
  | {
      readonly type: "WAR_ENDED";
      readonly by: PowerId;
      readonly against: PowerId;
    }
  | { readonly type: "PEACE_LOAN_FAILED"; readonly by: PowerId; readonly target: PowerId }
  /** A power lost its last area and is out of the game. */
  | { readonly type: "POWER_ELIMINATED"; readonly power: PowerId }
  /** Annual payout at the start of spring. */
  | { readonly type: "INCOME"; readonly power: PowerId; readonly amount: number }
  | { readonly type: "GAME_WON"; readonly power: PowerId };
