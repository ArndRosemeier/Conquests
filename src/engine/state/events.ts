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
    }
  | {
      readonly type: "CONTROL_CHANGE";
      readonly area: AreaId;
      readonly from: PowerId | null;
      readonly to: PowerId | null;
    }
  | {
      readonly type: "REGION_BONUS";
      readonly power: PowerId;
      readonly region: number;
      readonly amount: number;
    }
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
  | { readonly type: "PEACE_LOAN_FAILED"; readonly by: PowerId; readonly target: PowerId };
