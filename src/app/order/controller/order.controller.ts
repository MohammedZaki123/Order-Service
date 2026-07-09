import {NextFunction, Request, Response} from "express";
import {inject, injectable} from "tsyringe";
import {OrderService} from "../service/order.service";
import {OrderStatusService} from "../service/order-status.service";
import {CreateOrderRequestDTO, UpdateOrderStatusRequestDTO} from "../dto/order.request.dto";
import {OrderResponseDTO, OrderSummaryResponseDTO, OrderStatusResponseDTO} from "../dto/order.response.dto";
import {validateBody} from "../../../lib/validation/validate";
import {sendSuccess, sendPaginated} from "../../../lib/http/response";
import {AppError} from "../../../lib/error/AppError";
import {RegionNotResolvedError} from "../../../lib/sharding/errors";
import {parsePaginationQuery} from "../../../lib/http/pagination/parse-query";
import {OrderStatus} from "../enums";
import {ActorContext} from "../types";

@injectable()
export class OrderController {
    constructor(
        @inject(OrderService) private readonly orderService: OrderService,
    ) {}

    placeOrder = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const dto = await validateBody(CreateOrderRequestDTO, req.body);
            const actor = {
                userId: req.user?.userId!,
                role: req.user?.role!,
                restaurantId: req.user?.restaurantId,
                restaurantRole: req.user?.restaurantRole,
                branchId: req.user?.branchIds,
            };

            const result = await this.orderService.
            placeOrder(actor, req.region!, dto, req.correlationId);
            
            sendSuccess(res, result, 201);
        } catch (err) {
            next(err);
        }
    };

    getOrder = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const publicId = req.params.publicId as string;
            const actor = {
                userId: req.user?.userId!,
                role: req.user?.role!,
                restaurantId: req.user?.restaurantId,
                restaurantRole: req.user?.restaurantRole,
                branchId: req.user?.branchIds,
            }
            const response = await this.orderService.getOrder(actor, publicId, req.region!);
            
            // In a real app, we'd fetch branch/restaurant names here too, or have them in the order snapshot
            sendSuccess(res, response);
        } catch (err) {
            next(err);
        }
    };

    updateStatus = async (req: Request, res: Response, next: NextFunction) => {
        try {

            // DO NOT Make any controller method to access any service layer method except the one it is responsible for. In this case, Update Status of controller should only call update method of service.
            const orderId = req.params.publicId as string;
            const dto = await validateBody(UpdateOrderStatusRequestDTO, req.body);
            
            // // The orderId in the new route is the order's publicId
            // const {order} = await this.orderService.getOrder(orderId, req.region!);

            // // Validate that the order belongs to the restaurant/branch
            // if (String(order.restaurantId) !== restaurantId || String(order.branchId) !== branchId) {
            //     throw new AppError("Order does not belong to this restaurant/branch", 403);
            // }

            const actor: ActorContext = {
                userId: req.user?.userId!,
                role: req.user?.role!,
                restaurantId: req.user?.restaurantId,
                restaurantRole: req.user?.restaurantRole,
                branchIds: req.user?.branchIds,
            };

            const updated = await this.orderService.updateStatus(actor,dto, req.region!, orderId);
            
            sendSuccess(res, updated);
        } catch (err) {
            next(err);
        }
    };

    listMyOrders = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if(req.region === "all") throw RegionNotResolvedError; // customer-specific endpoint should never fan out
            const year = Number(req.query.year) || new Date().getUTCFullYear();
            const customerId = req.user?.userId!;
            const region = req.region!;
            const pagination = parsePaginationQuery(req.query as Record<string, unknown>, ["createdAt"]);
            const orders = await this.orderService.listCustomerOrders(String(customerId), region, year, pagination);

            sendPaginated(res, orders.data, orders.meta) // simplified pagination
        } catch (err) {
            next(err);
        }
    };

    listRestaurantOrders = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if(req.region === "all") throw RegionNotResolvedError; // restaurant-specific endpoint should never fan out
            // const restaurantId = Number( req.params.restaurantId);
            const branchId = Number(req.params.branchId);
            const status = req.query.status as OrderStatus;
            const pagination = parsePaginationQuery(req.query as Record<string, unknown>, ["createdAt"]);
            const from = req.query.from ? new Date(String(req.query.from)) : undefined;
            const to = req.query.to ? new Date(String(req.query.to)) : undefined;
            // Note: validation of `status` against `OrderStatus` enum should ideally happen in request DTO,
            // but we can pass it as any for now.
            const result = await this.orderService.listRestaurantOrders
            (branchId,req.region!, status, from, to, pagination);
            sendPaginated(res,result.data,result.meta);
        } catch (err) {
            next(err);
        }
    };

}
