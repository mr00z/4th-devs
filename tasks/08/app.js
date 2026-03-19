import { run } from "./src/agent.js";
import log from "./src/helpers/logger.js";

const main = async () => {
    await log.reset();
    log.box("Failure Breakdown Agent\nAnalyze plant failure logs");

    const result = await run();
    log.success("Agent finished");
    log.data("final-result", result);

    if (result.flag) {
        console.log(result.flag);
        return;
    }

    console.log(JSON.stringify(result, null, 2));
};

main().catch((error) => {
    log.error("Fatal error", error.message);
    log.flush().finally(() => process.exit(1));
});
