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
  | { readonly type: "SUBVERT"; readonly area: AreaId; readonly amount: number }
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
  /** Finish the current phase for the active power. */
  | { readonly type: "END_PHASE" };

export type ActionType = Action["type"];
