import {Knex} from "knex";

export async function up(knex: Knex): Promise<void> {
    // We use raw SQL for partitioned table creation as Knex doesn't fully support PARTITION BY yet.
    await knex.raw(`CREATE SEQUENCE IF NOT EXISTS orders_id_seq AS BIGINT`);

    await knex.raw(`
        CREATE TABLE orders (
            id BIGINT NOT NULL DEFAULT nextval('orders_id_seq'::regclass),
            region TEXT NOT NULL,
            public_id UUID NOT NULL,
            country_code TEXT NOT NULL,
            restaurant_id BIGINT NOT NULL,
            restaurant_owner_id BIGINT NOT NULL,
            branch_id BIGINT NOT NULL,
            customer_id BIGINT NOT NULL,
            customer_address_id BIGINT NOT NULL,
            delivery_lat DECIMAL(10,7) NOT NULL,
            delivery_lng DECIMAL(10,7) NOT NULL,
            delivery_address_text_snapshot TEXT NOT NULL,
            
            -- denormalized core service branch row to avoid calling hot endpoint branch info
            branch_lat DECIMAL(10,7) NOT NULL,
            branch_lng DECIMAL(10,7) NOT NULL,

            status TEXT NOT NULL CHECK (status IN (
                'pending_payment','placed','accepted','rejected',
                'preparing','ready','assigned','picked','delivered','cancelled'
            )),
            subtotal INT NOT NULL,
            delivery_fee INT NOT NULL,
            service_fee INT NOT NULL,
            total INT NOT NULL,
            commission INT NOT NULL DEFAULT 0,
            currency TEXT NOT NULL,
            payment_method TEXT NOT NULL CHECK (payment_method IN ('online','cod')),
            delivery_agent_id BIGINT,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
            accepted_at TIMESTAMP NULL,
            rejected_at TIMESTAMP NULL,
            ready_at TIMESTAMP NULL,
            assigned_at TIMESTAMP NULL,
            picked_at TIMESTAMP NULL,
            delivered_at TIMESTAMP NULL,
            cancelled_at TIMESTAMP NULL,
            PRIMARY KEY (id, created_at)
        ) PARTITION BY RANGE (created_at);
    `);

    await knex.raw(`ALTER SEQUENCE orders_id_seq OWNED BY orders.id`);

    // Add other indexes
    await knex.raw('CREATE INDEX idx_orders_public_id ON orders (public_id)');
    await knex.raw('CREATE INDEX idx_orders_customer_id_created_at ON orders (customer_id, created_at DESC)');
    await knex.raw('CREATE INDEX idx_orders_branch_status_created_at ON orders (branch_id, status, created_at DESC)');
    await knex.raw('CREATE INDEX idx_orders_status_created_at ON orders (status, created_at) WHERE status IN (\'ready\',\'assigned\')');
    await knex.raw('CREATE INDEX idx_orders_delivery_agent_id_status ON orders (delivery_agent_id, status) WHERE delivery_agent_id IS NOT NULL');

    // // pg_partman setup
    // try {
    //     // Create the parent in pg_partman
    //     // Note: This assumes pg_partman extension is installed and available in the 'partman' schema
    //     await knex.raw("SELECT partman.create_parent('public.orders', 'created_at', 'native', 'yearly')");
    // } catch (err) {
    //     console.warn("pg_partman call failed. Ensure the extension is installed and schema 'partman' exists.", err);
    // }

    await knex.raw(`CREATE TABLE orders_default PARTITION OF orders DEFAULT;`)
}

export async function down(knex: Knex): Promise<void> {
    // try {
    //     await knex.raw("DELETE FROM partman.part_config WHERE parent_table = 'public.orders'");
    // } catch (err) {}
    
    // await knex.schema.dropTable("orders");

    await knex.raw(`DROP TABLE IF EXISTS orders CASCADE;`);

}
