import 'reflect-metadata';
import { config } from 'dotenv';
import path from 'node:path';

// Load test env FIRST before anything else
config({ path: path.resolve(__dirname, '../.env.test'), override: true });

// ── Infrastructure Mocks (must be before any src/ imports) ──────────────────

jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        connect: jest.fn().mockResolvedValue(true),
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
        quit: jest.fn().mockResolvedValue('OK'),
        duplicate: jest.fn().mockReturnThis(),
        subscribe: jest.fn().mockResolvedValue(true),
    }));
});

jest.mock('amqp-connection-manager', () => ({
    connect: jest.fn().mockReturnValue({
        createChannel: jest.fn().mockReturnValue({
            waitForConnect: jest.fn().mockResolvedValue(true),
            close: jest.fn().mockResolvedValue(true),
            publish: jest.fn().mockResolvedValue(true),
        }),
        close: jest.fn().mockResolvedValue(true),
    }),
}));

// ── Mock the production DI container with our test-safe one ─────────────────
// This intercepts any import of "src/lib/di/container" across all src/ files
// (routes, rbac, etc.) and returns the tsyringe container populated by
// test-container.ts — crucially, it never executes the real container.ts which
// has the KashierClient before-initialization bug.
jest.mock('../src/lib/di/container', () => {
    const { container, mockCache, mockBroker, mockWs, mockKashier } = require('./helpers/test-container');
    return { container, mockCache, mockBroker, mockWs, mockKashier };
});
