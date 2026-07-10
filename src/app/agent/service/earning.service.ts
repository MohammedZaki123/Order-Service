import {injectable} from "tsyringe";
import * as agentEarningRepo from "../repository/agent-earning.repo";
import * as orderRepo from "../../order/repository/order.repo";
import {db} from "../../../lib/knex/knex";
import {AgentEarningsResponseDTO} from "../dto/agent.response.dto";

@injectable()
export class EarningService {
    async getEarnings(
        agentId: number,
        region: string,
        from: Date,
        to: Date,
        limit?: number,
        cursor?: string
    ): Promise<AgentEarningsResponseDTO> {
        const conn = db(region);
        const earnings = await agentEarningRepo.findEarningsByAgent(
            agentId,
            region,
            from,
            to,
            100, // limit,
            conn
        );
        const sum = earnings.reduce((acc, e) => acc + e.amount, 0);

        // for (const e of earnings) {
        //     // N + 1 query
        //     const order = await orderRepo.findOrderById(e.orderId, e.orderCreatedAt, region, conn);
        //     if (order) {
        //         orderPublicIds.set(e.orderId, order.publicId);
        //     }
        // }

        // const nextCursor =
        //     earnings.length === limit
        //         ? earnings[earnings.length - 1].earnedAt.toISOString()
        //         : null;

        return AgentEarningsResponseDTO.from(from,to, earnings, sum);
    }
}
