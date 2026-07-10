import {coreClient} from "./core-client";
import {CoreEnvelope, CoreAgent} from "./types";

export async function getAgent(agentId: number, correlationId?: string): Promise<CoreAgent> {
    const res = await coreClient.request<CoreEnvelope<CoreAgent>>({
        method: "GET",
        path: `/api/internal/agents/${agentId}`,
        correlationId,
    });
    return res.data;
}
