# user_proxy

`user_proxy` is a small Python CoralOS participant for representing a human in a session. It connects and idles; a driving process sends messages as this agent through CoralOS puppet API calls.

**No example in this repo currently launches it.** It was built for a human-checkout flow (`examples/agent-economy/bridge`) that has since been removed. The directory is kept as a working reference for the puppet-API pattern, not as an active dependency of `txodds/`.

## Purpose

Human users do not connect as MCP agents. A driving process can use `user_proxy` so human orders and payment notifications appear in a CoralOS thread as a named participant, rather than being invisible to the session.

## Runtime Shape

```python
async with streamablehttp_client(url) as (read, write, _):
    async with ClientSession(read, write) as session:
        await session.initialize()
        await asyncio.Event().wait()
```

The driving process (not this agent) is responsible for puppet sends and for reading replies from extended session state.

## Build

```sh
docker build -t user-proxy:0.1.0 coral-agents/user_proxy
```

`CORAL_CONNECTION_URL` is injected by CoralOS at launch. The agent is registered through the local agent registry.

## Notes

- Currently unused — see the note above.
- Holds no wallet and no API keys.
- Can be replaced by a TypeScript implementation if desired; no protocol behavior depends on Python.
