import { run } from './src/agent.js';
import log from './src/helpers/logger.js';

const main = async () => {
    await log.reset();
    log.box('Failure Logs Agent\nFind breakdown-relevant events');

    const result = await run();
    log.success('Agent finished');

    if (result.flag) {
        console.log(result.flag);
        return;
    }

    console.log(JSON.stringify(result, null, 2));
};

main().catch((error) => {
    log.error('Fatal error', error instanceof Error ? error.message : String(error));
    log.flush().finally(() => process.exit(1));
});

