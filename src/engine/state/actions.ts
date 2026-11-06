import type { AreaId, PowerId } from "../types.ts";

/**
 * All player actions as serializable data. Because human and AI controllers
 * both produce Actions, they are fully interchangeable to the engine. Actions
 * also enable undo, replay, and networking essentially for free.
 */
export type Action =
  | { readonly type: "BUILD_ARMY"; readonly area: AreaId; readonly troops: number }
  | { readonly type: "BUILD_FLEET"; readonly area: AreaId; readonly fleets: number }
  | { readonly type: "FORTIFY"; readonly area: AreaId }
  | { readonly type: "LOAN_POWER"; readonly target: PowerId; readonly amount: number }
  | { readonly type: "LOAN_MINOR"; readonly area: AreaId; readonly amount: number }
  | { readonly type: "SPY"; readonly area: AreaId }
  | { readonly type: "SUBVERT"; readonly area: AreaId }
  | {
      readonly type: "MOVE_ARMY";
      readonly from: AreaId;
      readonly to: AreaId;
      readonly troops: number;
    }
  | {
      readonly type: "MOVE_FLEET";
      readonly from: AreaId;
      readonly to: AreaId;
      readonly fleets: number;
      readonly troops: number;
    }
  /** Declare war on another power (costs reputation; blocked during a truce). */
  | { readonly type: "DECLARE_WAR"; readonly target: PowerId }
  /**
   * Offer peace to an enemy; `payment` is paid on acceptance (negative = demand tribute).
   * `cede` are areas you hand over, `demand` areas you ask for.
   */
  | {
      readonly type: "OFFER_PEACE";
      readonly target: PowerId;
      readonly payment: number;
      readonly cede?: readonly AreaId[];
      readonly demand?: readonly AreaId[];
    }
  /** Accept or refuse a peace offer made to you. */
  | { readonly type: "ANSWER_PEACE"; readonly from: PowerId; readonly accept: boolean }
  /** Propose a non-aggression pact, an alliance, or war aid against `enemy`. `payment` is paid on acceptance (negative = asked for). */
  | {
      readonly type: "PROPOSE";
      readonly to: PowerId;
      readonly kind: "pact" | "alliance" | "aid";
      readonly payment: number;
      readonly years: number;
      readonly enemy: PowerId | null;
    }
  | { readonly type: "ANSWER_PROPOSAL"; readonly from: PowerId; readonly kind: "pact" | "alliance" | "aid"; readonly accept: boolean }
  /** Join (or refuse) an ally's war after it was attacked. */
  | { readonly type: "ANSWER_CALL"; readonly partner: PowerId; readonly join: boolean }
  | { readonly type: "LEAVE_ALLIANCE"; readonly ally: PowerId }
  /** Join (or found) the coalition against a pariah, declaring war on it if needed. */
  | { readonly type: "JOIN_COALITION"; readonly target: PowerId }
  /** Finish the active power's turn. */
  | { readonly type: "END_TURN" };

export type ActionType = Action["type"];
