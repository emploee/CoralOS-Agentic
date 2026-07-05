# Deliver Service

Seller behavior usually starts in one of these places:

- `coral-agents/seller-agent/src/service.ts`
- `examples/txodds/agent/service.ts`
- A harness adapter in `packages/harness-runtime`

Pattern:

1. Parse the buyer request.
2. Price the result in the seller bid.
3. Perform upstream procurement only after award and policy approval.
4. Return deterministic output where possible.
5. Include hashes or source references so a verifier can check the delivery.

Do not let service code hold unrestricted wallet authority. Use `payment-runtime` and policy checks for paid upstream calls.
