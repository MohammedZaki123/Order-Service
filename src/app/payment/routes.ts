import {Router} from "express";
import {container} from "../../lib/di/container";
import {TOKENS} from "../../lib/di/tokens";
import {PaymentController} from "./controller/payment.controller";
import {authenticate} from "../../lib/auth/guard";
import {requireConcreteRegion} from "../../lib/sharding/region-resolver";
import {rbac, requireRestaurantMember} from "../../lib/auth/rbac";

export const paymentRouter = Router();
const paymentController = container.resolve<PaymentController>(TOKENS.PaymentController);


paymentRouter.post("/payments/webhook/kashier",
    requireConcreteRegion,
    paymentController.handleKashierWebhook
);

paymentRouter.post("/payments/transactions/:id/refund",
    authenticate,
    requireConcreteRegion,
    rbac({resource: "payments", action: "refund"}),
    paymentController.refundPayment
);


// Restaurant-scoped read. requireRestaurantMember + rbac handle the auth;
// the service only verifies the payment actually belongs to this restaurant.
paymentRouter.get(
    "/restaurants/:restaurantId/payments/:paymentId",
    authenticate,
    requireConcreteRegion,
    requireRestaurantMember("restaurantId"),
    rbac({resource: "payments", action: "read"}),
    paymentController.getById,
);
