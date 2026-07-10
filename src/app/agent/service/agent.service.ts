import {injectable, inject} from "tsyringe";
import * as orderRepo from "../../order/repository/order.repo";
import {db} from "../../../lib/knex/knex";
import {OrderStatus} from "../../order/enums";
import {DeliveryTaskResponseDTO} from "../dto/agent.response.dto";
import {OrderEntity} from "../../order/entity/order.entity";
import {TOKENS} from "../../../lib/di/tokens";
import {AssignmentService} from "../../assignment/service/assignment.service";
import {getBranchesByIds} from "../../../lib/core-client/branch.client";
const TASK_LIST_LIMIT = 50;

@injectable()
export class AgentService {
    constructor(
        @inject(TOKENS.AssignmentService)
        private readonly assignmentService: AssignmentService,
    ) {}

    async listTasks(
        agentId: number,
        region: string,
        statusFilter?: OrderStatus
    ): Promise<DeliveryTaskResponseDTO[]> {
        const conn = db(region);
        const statuses = statusFilter
            ? [statusFilter]
            : [OrderStatus.ASSIGNED, OrderStatus.PICKED];

        const orders = await orderRepo.findOrdersByDeliveryAgent(agentId,statuses,  TASK_LIST_LIMIT, conn);

        const branchMap = await getBranchesByIds(orders.map((o) => o.branchId));
        const enriched = new Map<number, {lat: number; lng: number; name: string; addressText: string}>();
        for (const [id, b] of branchMap) {
            enriched.set(id, {lat: b.lat, lng: b.lng, name: b.name, addressText: b.addressText});
        }
        return this.toTaskDtos(orders);
    }

    // async listCompletedTasks(
    //     agentId: number,
    //     region: string,
    //     limit: number,
    //     cursor?: string
    // ): Promise<DeliveryTaskResponseDTO[]> {
    //     const conn = db(region);
    //     const orders = await orderRepo.findDeliveredOrdersByAgent(agentId, region, limit, cursor, conn);
    //     return this.toTaskDtos(orders);
    // }

    /** Delegate to AssignmentService.claim (atomic race-safe accept). */
    async accept(publicId: string, agentId: number, region: string): Promise<DeliveryTaskResponseDTO> {
        return this.assignmentService.claim(publicId, agentId, region);
    }

    async reject(publicId: string, agentId: number): Promise<void> {
        return this.assignmentService.reject(publicId, agentId);
    }

    private toTaskDtos(orders: OrderEntity[]): DeliveryTaskResponseDTO[] {
        return orders.map((order) => DeliveryTaskResponseDTO.from(order));
    }
}
