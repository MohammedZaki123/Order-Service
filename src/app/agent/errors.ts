import {AppError} from "../../lib/error/AppError";

export const NotOnlineError = new AppError("NotOnline", 409);
export const AgentInActiveDeliveryError = new AppError("AgentInActiveDelivery", 409);
export const OfferNotFoundOrExpiredError = new AppError("OfferNotFoundOrExpired", 410);
export const NotInCandidateListError = new AppError("NotInCandidateList", 403);
export const OrderAlreadyClaimedError = new AppError("OrderAlreadyClaimed", 409);
export const OrderNotInReadyStateError = new AppError("OrderNotInReadyState", 409);
