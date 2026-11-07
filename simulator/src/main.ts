import { createInterface } from 'node:readline';
import { COMMAND_HELP, parseCommand } from './commands.js';
import { ConfigError, loadConfig } from './config.js';
import { DeviceClient } from './device-client.js';
import { createConsoleLogger, type Logger } from './logger.js';

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
  if (config.offline) {
    logger.state(
      `offline mode: clock offset ${config.offline.clockOffsetSec} s, state file ${config.offline.stateFile ?? '(memory)'}`,
    );
  }
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

  listen(client, logger);
  client.start();
}

/** Reads the interactive commands from stdin; an unknown one never exits. */
function listen(client: DeviceClient, logger: Logger): void {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  logger.state('Type `help` for the interactive commands.');
  rl.setPrompt('sim> ');
  rl.prompt();
  rl.on('line', (line) => {
    const command = parseCommand(line);
    switch (command.kind) {
      case 'scan':
        client.scan(command.slot);
        break;
      case 'button':
        client.pressButton();
        break;
      case 'disconnect':
        client.disconnect();
        break;
      case 'reconnect':
        client.reconnect();
        break;
      case 'net':
        if (command.online) client.reconnect();
        else client.disconnect();
        break;
      case 'help':
        logger.state(COMMAND_HELP);
        break;
      case 'invalid':
        logger.warn(`${command.reason} (input: "${command.input}")`);
        break;
      case 'empty':
        break;
    }
    rl.prompt();
  });
}

main();
