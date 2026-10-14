#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { requireStudioHome } from "@patchbay/core";
import { createServer } from "./server.js";

/**
 * Real entrypoint: build the server (read tools + P4 writes) and connect
 * it to stdio -- this is the only file in the package that touches a
 * transport.
 */
// 작업 공간이 없으면 빈 것을 만들지 않고 여기서 멈춘다 (저장구조.md 3절).
const server = createServer(requireStudioHome());
const transport = new StdioServerTransport();
await server.connect(transport);
