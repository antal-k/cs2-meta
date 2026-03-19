import chalk from "chalk";
import ora, { type Ora } from "ora";

type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

let currentLevel: LogLevel = "info";
let spinner: Ora | null = null;

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function timestamp(): string {
  return chalk.dim(`[${new Date().toISOString()}]`);
}

export const logger = {
  setLevel(level: LogLevel) {
    currentLevel = level;
  },

  debug(...args: unknown[]) {
    if (shouldLog("debug")) {
      console.log(timestamp(), chalk.gray("DBG"), ...args);
    }
  },

  info(...args: unknown[]) {
    if (shouldLog("info")) {
      console.log(timestamp(), chalk.blue("INF"), ...args);
    }
  },

  success(...args: unknown[]) {
    if (shouldLog("info")) {
      console.log(timestamp(), chalk.green("OK "), ...args);
    }
  },

  warn(...args: unknown[]) {
    if (shouldLog("warn")) {
      console.warn(timestamp(), chalk.yellow("WRN"), ...args);
    }
  },

  error(...args: unknown[]) {
    if (shouldLog("error")) {
      console.error(timestamp(), chalk.red("ERR"), ...args);
    }
  },

  step(message: string) {
    if (shouldLog("info")) {
      console.log(
        timestamp(),
        chalk.cyan(">>>"),
        chalk.bold(message)
      );
    }
  },

  spin(message: string): Ora {
    if (spinner) spinner.stop();
    spinner = ora({ text: message, prefixText: timestamp() }).start();
    return spinner;
  },

  stopSpin(message?: string, success = true) {
    if (spinner) {
      if (success) {
        spinner.succeed(message);
      } else {
        spinner.fail(message);
      }
      spinner = null;
    }
  },
};
