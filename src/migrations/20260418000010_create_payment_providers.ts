import {Knex} from "knex";

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE payment_providers (
            id INT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            is_enabled BOOLEAN NOT NULL DEFAULT true,
            priority SMALLINT NOT NULL DEFAULT 100
        );
    `);
    
    // Inseting Kashier for Egypt region shard only
    const region = (process.env.REGION ?? "").toLowerCase();
    if (region === "eg") {
        await knex("payment_providers").insert({id: 1, name: "kashier", is_enabled: true, priority: 10});
    }
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS payment_providers;`);
}
