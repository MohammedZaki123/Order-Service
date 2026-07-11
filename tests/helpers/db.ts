import {db} from '../../src/lib/knex/knex';

export async function truncateAll(region: string = 'eg'): Promise<void> {
    const conn = db(region);
    const result = await conn.raw<{ rows: { tablename: string }[] }>(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN ('knex_migrations', 'knex_migrations_lock');
    `);

    if (result.rows.length === 0) return;

    const tableNames = result.rows.map(row => `"${row.tablename}"`).join(', ');
    await conn.raw(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE;`);
}
