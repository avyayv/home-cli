import "./env.js";
import { runIMessageBridge } from "./bridge-runtime.js";

runIMessageBridge().catch((error) => {
  console.error(error);
  process.exit(1);
});
