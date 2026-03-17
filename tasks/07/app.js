import { run } from "./src/agent.js";
import log from "./src/helpers/logger.js";

const main = async () => {
    await log.reset();
    log.box("Electricity Puzzle Agent\nSolve 3x3 rotation board");
    const result = await run();

    log.success("Agent finished");
    if (result.flag) {
        log.info("Flag received");
        console.log(result.flag);
        return;
    }

    log.data("result", result);
    console.log(JSON.stringify(result, null, 2));
};

main().catch((error) => {
    log.error("Fatal error", error.message);
    log.flush().finally(() => process.exit(1));
});
