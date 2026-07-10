import { Knex } from "knex";
import { AgentEarningEntity } from "../entity/agent-earning.entity";
import { db } from "../../../lib/knex/knex";

const EARNING_COLUMNS = [
    "id", "region", "agent_id", "order_id",
    "amount", "currency", "earned_at"
];

function toEntity(row: any): AgentEarningEntity {
    return new AgentEarningEntity({
        id: Number(row.id),
        region: row.region,
        agentId: Number(row.agent_id),
        orderId: Number(row.order_id),
        amount: Number(row.amount),
        currency: row.currency,
        earnedAt: new Date(row.earned_at),
    });
}

export async function insertEarning(
    data: Omit<AgentEarningEntity, "id" | "earnedAt">,
    conn: Knex
): Promise<AgentEarningEntity> {
    const [row] = await conn("agent_earnings")
        .insert({
            region: data.region,
            agent_id: data.agentId,
            order_id: data.orderId,
            amount: data.amount,
            currency: data.currency,
        })
        .onConflict("order_id")
        .ignore()
        .returning(EARNING_COLUMNS);

    if (row) {
        return toEntity(row);
    }

    const existing = await conn("agent_earnings")
        .select(EARNING_COLUMNS)
        .where({order_id: data.orderId})
        .first();
    if (!existing) {
        throw new Error("Failed to insert agent earning");
    }
    return toEntity(existing);
}

export async function findEarningsByAgent(
    agentId: number,
    region: string,
    from: Date,
    to: Date,
    limit: number,
    conn: Knex = db(region),
    cursor?: string,
): Promise<AgentEarningEntity[]> {
    let query = conn("agent_earnings")
        .select(EARNING_COLUMNS)
        .where({ agent_id: agentId, region })
        .whereBetween("earned_at", [from, to])
        .orderBy("earned_at", "desc")
        .limit(limit);

    if (cursor) {
        query = query.where("earned_at", "<", cursor);
    }

    const rows = await query;
    return rows.map(toEntity);
}

export async function sumEarningsByAgent(
    agentId: number,
    region: string,
    from: Date,
    to: Date,
    conn: Knex = db(region)
): Promise<{ [currency: string]: number }> {
    const results = await conn("agent_earnings")
        .select("currency")
        .sum("amount as total")
        .where({ agent_id: agentId, region })
        .whereBetween("earned_at", [from, to])
        .groupBy("currency");

    const sums: { [currency: string]: number } = {};
    for (const row of results) {
        sums[row.currency] = Number(row.total ?? 0);
    }
    return sums;
}

export async function sumAllEarnings(
    region: string,
    from: Date,
    to: Date,
    conn: Knex = db(region)
): Promise<{ [currency: string]: number }> {
    const results = await conn("agent_earnings")
        .select("currency")
        .sum("amount as total")
        .where({ region })
        .whereBetween("earned_at", [from, to])
        .groupBy("currency");

    const sums: { [currency: string]: number } = {};
    for (const row of results) {
        sums[row.currency] = Number(row.total ?? 0);
    }
    return sums;
}
