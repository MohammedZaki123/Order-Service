import {config} from 'dotenv';
import path from 'path';

config({path: path.resolve(__dirname, '../../.env.test')});

export default async function globalSetup() {
    try {
        // Set default region for migrations
        process.env.REGION = 'eg';
        const {db} = require('../../src/lib/knex/knex');
        const conn = db('eg');
        await conn.migrate.latest();
        console.log("Database migrations completed successfully for region 'eg'.");
    } catch(e) {
        console.error("Migration in globalSetup failed:", e);
        throw e;
    }
}
