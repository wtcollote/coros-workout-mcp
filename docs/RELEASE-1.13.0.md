# COROS Workout MCP 1.13.0

## Stable compatibility bridge

Adds three permanent tools designed to remain usable in chats that cache their MCP catalog:

- `coros_capabilities` returns the current server-side operation manifest and input contracts;
- `coros_read` executes allowlisted read-only operations through a schema that will remain stable;
- `coros_write` executes allowlisted writes and requires the operation-specific confirmation token.

Operation names are deliberately free strings rather than a schema enum. Future releases can add bridge operations without changing these three tool schemas. Existing dedicated tools remain available and are not renamed or removed.

Initial read operations cover connection status, authentication status, HRV, sleep, daily metrics, activities, calendar listing, personal calibration and multisport load. Initial writes cover calendar assignment, calendar movement, occurrence removal and library deletion.

This cannot inject tools into a historical chat that never loaded the plugin. One catalog refresh is required to receive the bridge; subsequent bridge operations can evolve without another tool-list update.

## Safety

- Read and write routes have separate MCP tools and annotations.
- Every operation uses an explicit server-side allowlist and Zod validation.
- Non-destructive writes require `CONFIRM`.
- Destructive removals and deletions require `DELETE`.
- Authentication credentials are not accepted through the generic bridge.

## Connector metadata

- Version: `1.13.0`
- Expected tools: `56`
- Compatibility bridge: `1`
