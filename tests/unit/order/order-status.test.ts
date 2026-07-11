import "reflect-metadata";
import { OrderStatusService } from "../../../src/app/order/service/order-status.service";
import { OrderStatus, StatusActor } from "../../../src/app/order/enums";
import { ReasonRequiredError } from "../../../src/app/order/errors";

describe("OrderStatusService Unit Tests (AAA)", () => {
    let statusService: OrderStatusService;

    beforeEach(() => {
        statusService = new OrderStatusService();
    });

    describe("assertTransition", () => {
        it("should allow valid transition from PENDING_PAYMENT to PLACED by SYSTEM", () => {
            // Arrange
            const current = OrderStatus.PENDING_PAYMENT;
            const next = OrderStatus.PLACED;
            const ctx = { actor: StatusActor.SYSTEM };

            // Act
            const result = statusService.assertTransition(current, next, ctx);

            // Assert
            expect(result).toEqual({ stamp: null });
        });

        it("should throw error for invalid status transitions", () => {
            // Arrange
            const current = OrderStatus.PENDING_PAYMENT;
            const next = OrderStatus.ACCEPTED;
            const ctx = { actor: StatusActor.CUSTOMER };

            // Act & Assert
            expect(() => {
                statusService.assertTransition(current, next, ctx);
            }).toThrow();
        });

        it("should throw ReasonRequiredError when reason is missing for REJECTED status", () => {
            // Arrange
            const current = OrderStatus.PLACED;
            const next = OrderStatus.REJECTED;
            const ctx = { actor: StatusActor.RESTAURANT_MEMBER, reason: "" };

            // Act & Assert
            expect(() => {
                statusService.assertTransition(current, next, ctx);
            }).toThrow(ReasonRequiredError);
        });

        it("should allow transition to REJECTED when reason is provided", () => {
            // Arrange
            const current = OrderStatus.PLACED;
            const next = OrderStatus.REJECTED;
            const ctx = { actor: StatusActor.RESTAURANT_MEMBER, reason: "Out of stock items" };

            // Act
            const result = statusService.assertTransition(current, next, ctx);

            // Assert
            expect(result).toEqual({ stamp: "rejected_at" });
        });
    });
});
