---
name: Payments Module
description: Business logic, DTOs, services, repositories and controller contract for handling payments via Kashier v3
type: reference
---

# Payments Module

## Scope
* Create a payment session with **Kashier v3**.
* Verify webhook callbacks from Kashier.
* Persist payment state in the `payments` table.
* Expose REST endpoints for the frontend and for internal services.
* Keep the ordering service loosely coupled – the payment flow is asynchronous after the session is created.

## External Dependency – Kashier v3
* **Create Session** – `POST https://api.kashier.io/v3/payment-sessions` with JSON body containing `amount`, `currency`, `orderId`, `customer` details, and `redirectUrl`.
* **Webhook** – Kashier will POST to `/api/v1/payments/kashier-webhook` with a signature header `X-Kashier-Signature`. Verify using the secret provided in the project config.
* **Reference Docs**: https://developers.kashier.io/payment/payment-sessions and https://developers.kashier.io/webhooks/setup

## DTOs
### CreatePaymentRequest
```json
{
  "orderId": "uuid",
  "paymentMethod": "KASHIER",
  "returnUrl": "https://app.quickbite.com/payment/return",
  "cancelUrl": "https://app.quickbite.com/payment/cancel",
  "regionCode": "US"
}
```
### CreatePaymentResponse
```json
{
  "paymentId": "uuid",
  "kashierSessionUrl": "https://pay.kashier.io/session/xxxx",
  "status": "PENDING",
  "createdAt": "2026-04-21T15:02:00Z"
}
```
### KashierWebhookPayload (internal representation)
```json
{
  "paymentId": "uuid",
  "kashierPaymentId": "string",
  "status": "SUCCESS|FAILED|CANCELLED",
  "amount": 23.50,
  "currency": "USD",
  "processedAt": "2026-04-21T15:04:12Z"
}
```

## Service Layer (`app/payments/service`)
* `PaymentService.initiate(dto: CreatePaymentRequest): CreatePaymentResponse`
  * Validate order existence (`OrderRepository.findById`).
  * Call Kashier **Create Session** API (HTTP client with timeout 5 s, retry‑backoff 3 times).
  * Store a row in `payments` with `status = PENDING` and the returned `kashier_payment_id`.
* `PaymentService.handleWebhook(payload: KashierWebhookPayload)`
  * Verify signature using HMAC‑SHA256 and the secret from `settings.json`.
  * Update `payments` row status atomically.
  * Insert an `order_events` entry (`PAYMENT_UPDATED`) for websocket propagation.
  * If payment succeeded, trigger `OrderService.updateStatus(orderId, CONFIRMED)`.

## Repository (`pkg/repository/payments`)
* `PaymentsRepository.insert(payment)` – returns generated `payment_id`.
* `PaymentsRepository.updateStatus(paymentId, newStatus, processedAt)` – uses **optimistic locking** via a `version` column to avoid race conditions on duplicate webhook calls.
* `PaymentsRepository.findByOrderId(orderId)` – used for idempotent session creation.

## Caching
* No long‑term cache for payment state – it is authoritative in the DB.
* Short‑term Redis lock (`payment:webhook:{kashierPaymentId}`) prevents duplicate processing of the same webhook.

## Idempotency & Retry
* The **CreatePayment** endpoint accepts an `Idempotency-Key`. The service stores a hash of the request together with the generated `payment_id` for 10 min.
* Webhook handling is **idempotent** – the status update is performed only if the stored version is older than the incoming status.

## Error handling
| Situation | HTTP status | Reason |
|-----------|-------------|--------|
| Invalid orderId | 404 | Order not found |
| Kashier API error | 502 | Bad gateway to external payment provider |
| Signature verification fails | 400 | Invalid webhook |
| Duplicate webhook (already processed) | 200 | Acknowledged – no state change |

## Security considerations
* Store Kashier secret in `settings.json` under `payments.kashierSecret` – never commit to repo.
* All outbound calls to Kashier use TLS and the secret is sent in the `Authorization: Bearer <token>` header.
* Webhook endpoint is **CSRF‑protected** by requiring the signature header.

---
*The payments module follows the same layering strategy as the core service, keeping external HTTP calls isolated in a thin `client` package and allowing easy mocking for unit tests.*
