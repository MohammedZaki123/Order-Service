import "reflect-metadata";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../../../src/app";
import { db } from "../../../src/lib/knex/knex";
import { env } from "../../../src/lib/config/env";
import { truncateAll } from "../../helpers/db";
import { getBranch, getBranchProducts, reserveStock } from "../../../src/lib/core-client/branch.client";
import { getCustomerAddress } from "../../../src/lib/core-client/address.client";

// Mock Core Client APIs
jest.mock("../../../src/lib/core-client/branch.client", () => ({
    getBranch: jest.fn(),
    getBranchProducts: jest.fn(),
    reserveStock: jest.fn(),
    undoReserveStock: jest.fn(),
}));

jest.mock("../../../src/lib/core-client/address.client", () => ({
    getCustomerAddress: jest.fn(),
    flattenAddress: jest.fn().mockReturnValue("123 Test St, Cairo, EG"),
}));

jest.mock("../../../src/lib/core-client/rbac.client", () => ({
    getRolePermissions: jest.fn().mockResolvedValue(["orders:update"]),
}));

// Helper to generate auth cookie
function getAuthCookie(payload: { userId: number; role: string; email: string; restaurantId?: number; restaurantRole?: string; branchIds?: number[] }): string {
    const token = jwt.sign(payload, env.jwt.accessSecret, { expiresIn: "1h" });
    return `access_token=${token}`;
}

describe("Order Service Integration Tests (AAA)", () => {
    const app = createApp();

    beforeEach(async () => {
        // Arrange - Truncate the DB between tests to ensure isolation
        await truncateAll("eg");
        jest.clearAllMocks();
    });

    describe("POST /api/orders", () => {
        it("should successfully place a COD order and write to DB", async () => {
            // Arrange
            const mockBranchData = {
                id: 10,
                restaurantId: 5,
                restaurantOwnerId: 100,
                name: "Test Branch",
                isActive: true,
                acceptOrders: true,
                lat: 30.0444,
                lng: 31.2357,
                deliveryFee: 1500, // 15 EGP
                commissionBps: 1000,
                currency: "EGP",
                region: "eg",
                restaurantStatus: "active"
            };

            const mockAddressData = {
                id: 20,
                userId: 1,
                lat: 30.0450,
                lng: 31.2360,
                building: "Building A",
                street: "Test St",
                city: "Cairo",
                country: "Egypt"
            };

            const mockProductData = [
                {
                    productId: 101,
                    branchId: 10,
                    price: 5000, // 50 EGP
                    stock: 10,
                    isAvailable: true,
                    name: "Test Burger",
                    imageUrl: "http://example.com/burger.jpg"
                }
            ];

            (getBranch as jest.Mock).mockResolvedValue(mockBranchData);
            (getCustomerAddress as jest.Mock).mockResolvedValue(mockAddressData);
            (getBranchProducts as jest.Mock).mockResolvedValue(mockProductData);
            (reserveStock as jest.Mock).mockResolvedValue({ success: true });

            const authCookie = getAuthCookie({
                userId: 1,
                role: "customer",
                email: "customer@test.com"
            });

            const orderPayload = {
                branchId: 10,
                customerAddressId: 20,
                paymentMethod: "cod",
                items: [
                    {
                        productId: 101,
                        quantity: 2
                    }
                ]
            };

            const idempotencyKey = `kplace-${Date.now()}-${Math.random()}`;

            // Act
            const res = await request(app)
                .post("/api/orders")
                .set("x-region", "eg")
                .set("idempotency-key", idempotencyKey)
                .set("Cookie", [authCookie])
                .send(orderPayload);

            // Assert
            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe("placed");
            expect(res.body.data.total).toBe(12500); // (5000 * 2) + 1500 delivery + 1000 service fee

            // Verify database state
            const dbOrders = await db("eg")("orders").select("*");
            expect(dbOrders.length).toBe(1);
            expect(dbOrders[0].status).toBe("placed");
            expect(Number(dbOrders[0].total)).toBe(12500);

            const dbOrderItems = await db("eg")("order_items").select("*");
            expect(dbOrderItems.length).toBe(1);
            expect(Number(dbOrderItems[0].product_id)).toBe(101);
            expect(dbOrderItems[0].quantity).toBe(2);
        });
    });

    describe("GET /api/orders/:publicId", () => {
        it("should successfully retrieve details of an existing order", async () => {
            // Arrange
            const publicId = "d3b07384-d113-4956-a5cc-5f333342d888";
            const now = new Date();

            // Seed order directly in database
            await db("eg")("orders").insert({
                region: "eg",
                public_id: publicId,
                country_code: "eg",
                restaurant_id: 5,
                restaurant_owner_id: 100,
                branch_id: 10,
                customer_id: 1,
                customer_address_id: 20,
                delivery_lat: 30.0450,
                delivery_lng: 31.2360,
                delivery_address_text_snapshot: "123 Test St, Cairo, EG",
                branch_lat: 30.0444,
                branch_lng: 31.2357,
                status: "placed",
                subtotal: 10000,
                delivery_fee: 1500,
                service_fee: 1000,
                total: 12500,
                currency: "EGP",
                payment_method: "cod",
                created_at: now,
                updated_at: now
            });

            const dbOrder = await db("eg")("orders").where({ public_id: publicId }).first();

            await db("eg")("order_items").insert({
                region: "eg",
                order_id: dbOrder.id,
                product_id: 101,
                quantity: 2,
                unit_price_snapshot: 5000,
                name_snapshot: "Test Burger",
                image_url_snapshot: "http://example.com/burger.jpg",
                line_total: 10000,
                created_at: now
            });

            const authCookie = getAuthCookie({
                userId: 1,
                role: "customer",
                email: "customer@test.com"
            });

            // Act
            const res = await request(app)
                .get(`/api/orders/${publicId}`)
                .set("x-region", "eg")
                .set("Cookie", [authCookie]);

            // Assert
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            // OrderDetailsResponseDTO shape: { order: { publicId, items, ... }, history: [] }
            expect(res.body.data.order.publicId).toBe(publicId);
            expect(res.body.data.order.status).toBe("placed");
            expect(res.body.data.order.items.length).toBe(1);
            expect(res.body.data.order.items[0].productId).toBe(101);
            expect(Array.isArray(res.body.data.history)).toBe(true);
        });
    });

    describe("PATCH /restaurants/:restaurantId/branches/:branchId/orders/:publicId/status", () => {
        it("should transition order status and insert transaction event into events_outbox", async () => {
            // Arrange
            const publicId = "d3b07384-d113-4956-a5cc-5f333342d999";
            const now = new Date();

            // Seed order directly in database
            await db("eg")("orders").insert({
                region: "eg",
                public_id: publicId,
                country_code: "eg",
                restaurant_id: 5,
                restaurant_owner_id: 100,
                branch_id: 10,
                customer_id: 1,
                customer_address_id: 20,
                delivery_lat: 30.0450,
                delivery_lng: 31.2360,
                delivery_address_text_snapshot: "123 Test St, Cairo, EG",
                branch_lat: 30.0444,
                branch_lng: 31.2357,
                status: "placed",
                subtotal: 10000,
                delivery_fee: 1500,
                service_fee: 1000,
                total: 12500,
                currency: "EGP",
                payment_method: "cod",
                created_at: now,
                updated_at: now
            });

            const authCookie = getAuthCookie({
                userId: 2,
                role: "restaurant_user",
                email: "restaurant@test.com",
                restaurantId: 5,
                restaurantRole: "owner",
                branchIds: [10]
            });

            const idempotencyKey = `kstatus-${Date.now()}-${Math.random()}`;

            // Act
            const res = await request(app)
                .patch(`/api/restaurants/5/branches/10/orders/${publicId}/status`)
                .set("x-region", "eg")
                .set("idempotency-key", idempotencyKey)
                .set("Cookie", [authCookie])
                .send({ status: "accepted" });

            // Assert
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe("accepted");

            // Verify order state in DB
            const dbOrder = await db("eg")("orders").where({ public_id: publicId }).first();
            expect(dbOrder.status).toBe("accepted");
            expect(dbOrder.accepted_at).toBeTruthy();

            // Verify event created in events_outbox
            const outboxEvents = await db("eg")("events_outbox").select("*");
            expect(outboxEvents.length).toBe(1);
            expect(outboxEvents[0].event_type).toBe("order.accepted");
            expect(outboxEvents[0].aggregate_id).toBe(publicId);
        });
    });
});
