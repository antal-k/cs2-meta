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
let activeSpinner: Ora | null = null;

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function timestamp(): string {
  return chalk.dim(`[${new Date().toISOString()}]`);
}

function logWithSpinnerGuard(fn: () => void): void {
  if (activeSpinner?.isSpinning) {
    activeSpinner.stop();
    fn();
    activeSpinner.start();
  } else {
    fn();
  }
}

export const logger = {
  setLevel(level: LogLevel) {
    currentLevel = level;
  },

  debug(...args: unknown[]) {
    if (shouldLog("debug")) {
      logWithSpinnerGuard(() => console.log(timestamp(), chalk.gray("DBG"), ...args));
    }
  },

  info(...args: unknown[]) {
    if (shouldLog("info")) {
      logWithSpinnerGuard(() => console.log(timestamp(), chalk.blue("INF"), ...args));
    }
  },

  success(...args: unknown[]) {
    if (shouldLog("info")) {
      logWithSpinnerGuard(() => console.log(timestamp(), chalk.green("OK "), ...args));
    }
  },

  warn(...args: unknown[]) {
    if (shouldLog("warn")) {
      logWithSpinnerGuard(() => console.warn(timestamp(), chalk.yellow("WRN"), ...args));
    }
  },

  error(...args: unknown[]) {
    if (shouldLog("error")) {
      logWithSpinnerGuard(() => console.error(timestamp(), chalk.red("ERR"), ...args));
    }
  },

  step(message: string) {
    if (shouldLog("info")) {
      logWithSpinnerGuard(() =>
        console.log(timestamp(), chalk.cyan(">>>"), chalk.bold(message)),
      );
    }
  },

  spin(message: string): Ora {
    if (activeSpinner) activeSpinner.stop();
    activeSpinner = ora({ text: message, prefixText: timestamp() }).start();
    return activeSpinner;
  },

  stopSpin(message?: string, success = true) {
    if (activeSpinner) {
      if (success) {
        activeSpinner.succeed(message);
      } else {
        activeSpinner.fail(message);
      }
      activeSpinner = null;
    }
  },
};
