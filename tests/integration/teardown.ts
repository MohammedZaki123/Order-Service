import {config} from 'dotenv';
import path from 'path';

config({path: path.resolve(__dirname, '../../.env.test')});

export default async function globalTeardown() {
    try {
        const {destroyAll} = require('../../src/lib/knex/knex');
        await destroyAll();
        console.log("Database connections destroyed successfully.");
    } catch(e) {
        console.error("Teardown failed:", e);
    }
}
