import {AppError} from "../../lib/error/AppError";

export const OrderNotReadyError = new AppError("OrderNotReady", 409);
export const OrderAlreadyAssignedError = new AppError("OrderAlreadyHasActiveDelivery", 409);
export const NoEligibleAgentsError = new AppError("NoEligibleAgents", 409);
export const MaxReassignmentAttemptsError = new AppError("MaxReassignmentAttemptsReached", 409);
