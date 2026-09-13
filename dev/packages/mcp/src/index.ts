#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

/**
 * Real entrypoint: build the server (spec Phase 6's four read-only tools)
 * and connect it to stdio -- this is the only file in the package that
 * touches a transport.
 */
const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
