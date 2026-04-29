import "reflect-metadata"
import http from 'http';
import {createApp} from "./app.js";
import {env} from "./lib/config/env.js";
import {db} from "./lib/knex/knex.js";

const app = createApp();

const server = http.createServer(app);

server.listen(env.port, () => {
    console.log(`Server is running on port ${env.port}`);
});

async function shutdown() {
    console.log('Shutting down server...');
    console.log('Database shutting down...');
    await db.destroy();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

