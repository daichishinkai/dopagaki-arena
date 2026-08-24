import { createRelay } from "./server";

const port = Number(process.env.PORT ?? 8080);
const relay = createRelay(port);
console.log(`[relay] listening on ws://localhost:${port}`);
relay.wss.on("connection", (_ws, req) => {
  console.log(`[relay] connection from ${req.socket.remoteAddress ?? "?"}`);
});
