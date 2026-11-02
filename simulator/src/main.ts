import { ConfigError, loadConfig } from './config.js';
import { DeviceClient } from './device-client.js';
import { createConsoleLogger } from './logger.js';

function main(): void {
  let config;
  try {
    config = loadConfig(process.env, process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }

  const logger = createConsoleLogger();
  logger.state(
    `simulator ${config.deviceId} (fw ${config.fw}) -> ${config.url}`,
  );
  logger.state(
    `enrollment: mode ${config.enroll.mode}, ${config.enroll.stepMs} ms per step`,
  );
  const client = new DeviceClient(config, logger);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.state(`${signal} received, closing`);
    void client.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  client.start();
}

main();
