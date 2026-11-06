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
      /** True only when the attacker took the area. A won fleet sortie keeps `attackerWon` but captures nothing. */
      readonly captured: boolean;
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
  /** `by` declared war on `against`, losing `reputationLoss` reputation. */
  | {
      readonly type: "WAR_DECLARED";
      readonly by: PowerId;
      readonly against: PowerId;
      readonly reputationLoss: number;
      /** How the war began: a plain declaration, an ally answering a call, or paid war aid. */
      readonly reason?: "declared" | "ally" | "aid";
    }
  | {
      readonly type: "TREATY_SIGNED";
      readonly kind: "pact" | "alliance";
      readonly a: PowerId;
      readonly b: PowerId;
      /** Paid by `a` (the proposer) to `b`; negative = the other way. */
      readonly payment: number;
      readonly years: number;
    }
  | {
      readonly type: "TREATY_ENDED";
      readonly kind: "pact" | "alliance";
      readonly a: PowerId;
      readonly b: PowerId;
      /** expired: ran its term · broken: a declaration of war · left: `a` left · refused: `a` refused a call to arms. */
      readonly reason: "expired" | "broken" | "left" | "refused";
    }
  | {
      readonly type: "PROPOSAL_MADE";
      readonly from: PowerId;
      readonly to: PowerId;
      readonly kind: "pact" | "alliance" | "aid";
      readonly payment: number;
      readonly enemy: PowerId | null;
    }
  | { readonly type: "PROPOSAL_DECLINED"; readonly by: PowerId; readonly from: PowerId; readonly kind: "pact" | "alliance" | "aid" }
  | { readonly type: "AID_AGREED"; readonly helper: PowerId; readonly victim: PowerId; readonly enemy: PowerId; readonly payment: number }
  | { readonly type: "CALL_TO_ARMS"; readonly ally: PowerId; readonly partner: PowerId; readonly enemy: PowerId }
  | { readonly type: "CALL_ANSWERED"; readonly ally: PowerId; readonly partner: PowerId; readonly enemy: PowerId; readonly joined: boolean }
  /** `against` accepted the peace `by` offered; `payment` went from `by` to `against` (negative: the other way). */
  | {
      readonly type: "WAR_ENDED";
      readonly by: PowerId;
      readonly against: PowerId;
      readonly payment: number;
    }
  | { readonly type: "PEACE_OFFERED"; readonly by: PowerId; readonly to: PowerId; readonly payment: number }
  | { readonly type: "PEACE_DECLINED"; readonly by: PowerId; readonly offerer: PowerId }
  /** An attack found the target held by a power it is not at war with, and turned back. */
  | { readonly type: "ATTACK_CALLED_OFF"; readonly power: PowerId; readonly area: AreaId; readonly owner: PowerId }
  /** A power lost its last area and is out of the game. */
  | { readonly type: "POWER_ELIMINATED"; readonly power: PowerId }
  /** Annual payout at the start of spring. */
  | { readonly type: "INCOME"; readonly power: PowerId; readonly amount: number }
  | { readonly type: "GAME_WON"; readonly power: PowerId };
