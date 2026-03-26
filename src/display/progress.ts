import ora from "ora";
import chalk from "chalk";

export function createSpinner(text: string) {
  return ora({ text: chalk.dim(text), spinner: "dots" });
}

export function logSuccess(text: string) {
  console.log(chalk.green("  ✓ ") + text);
}

export function logInfo(text: string) {
  console.log(chalk.blue("  ℹ ") + text);
}

export function logSection(text: string) {
  console.log("\n" + chalk.bold.yellow(`  [${text}]`));
}
