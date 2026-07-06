# user_proxy

`user_proxy` is a small Python CoralOS participant used by the checkout bridge. It connects to the session and idles; the bridge sends messages as this agent through CoralOS puppet API calls.

## Purpose

Human users do not connect as MCP agents. The bridge uses `user_proxy` so human orders and payment notifications can appear in a CoralOS thread as a named participant.

## Runtime Shape

```python
async with streamablehttp_client(url) as (read, write, _):
    async with ClientSession(read, write) as session:
        await session.initialize()
        await asyncio.Event().wait()
```

The bridge is responsible for puppet sends and for reading replies from extended session state.

## Build

```sh
docker build -t user-proxy:0.1.0 coral-agents/user_proxy
```

`CORAL_CONNECTION_URL` is injected by CoralOS at launch. The agent is registered through the local agent registry.

## Notes

- Used by the checkout bridge.
- Holds no wallet and no API keys.
- Can be replaced by a TypeScript implementation if desired; no protocol behavior depends on Python.
