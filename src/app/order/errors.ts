import { AppError } from "../../lib/error/AppError";


export const OrderNotFoundError = new AppError("Order Not Found", 404);
export const BranchNotAcceptingOrdersError = new AppError("Branch Not Accepting Orders", 409);
export const CancellationWindowExpiredError = new AppError("Cancellation Window Exceeded", 409);
export const ReasonRequiredError = new AppError("Reason required for this transition", 400);
export const OnlinePaymentNotAvailableError = new AppError("OnlinePaymentNotAvailableInRegion", 409);


export function invalidStatusTransitionError(from: string, to: string) {
    return new AppError(`Invalid status transition from ${from} to ${to}`, 409);
}

export function outOfStockError(offending: unknown) {
    return new AppError(JSON.stringify(offending) + " is out of stock", 409);
}
