// Cloudflare Worker entry. Workers only allow handler exports from the main module, so the logic
// and its test hooks live in app.js.
import app from "./app.js";
export default app;
