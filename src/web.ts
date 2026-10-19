import { createWebServer } from "./web-server.js";

const port = Number(process.env.PORT ?? "4173");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");

createWebServer().listen(port, "127.0.0.1", () => {
  console.log(`Pi Edge Diagnostic UI: http://127.0.0.1:${port}`);
});
