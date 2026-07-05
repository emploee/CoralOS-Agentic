# Market Protocol

Market messages live in `packages/agent-runtime/src/market/protocol.ts`.

Use the generic payment messages for new rails:

```text
PAYMENT_REQUIRED round=<n> rail=<rail> amount=<amount> currency=<asset> reference=<id>
PAYMENT_PROOF round=<n> rail=<rail> reference=<id> proof=<receipt>
PAYMENT_CONFIRMED round=<n> rail=<rail> reference=<id> paid=true
SETTLED round=<n> rail=<rail> reference=<id>
REFUNDED round=<n> rail=<rail> reference=<id>
```

Keep `ESCROW_REQUIRED` and `DEPOSITED` compatible for existing agents.

When adding fields:

- Include a parser and formatter.
- Add a unit test in `protocol.test.ts`.
- Keep fields tokenized unless the value is intentionally the final free-text field.
