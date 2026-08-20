import { confirm as rawConfirm, input as rawInput, select as rawSelect } from "@inquirer/prompts";

export const NO_TTY_MESSAGE =
  "no interactive terminal to prompt on — pass every value as an argument/flag (see --help), or add --defaults";

// @inquirer/prompts does reject on a non-TTY stdin, but only after it has
// written the question and its cursor escapes: a CI log then ends with a
// question nobody can answer, followed by raw ANSI, followed by the real
// error. Answering the no-TTY case before the prompt starts leaves only the
// line that says what to do instead.
//
// Every prompt in this CLI is imported from here rather than from
// @inquirer/prompts directly, so a prompt added later gets this for free.
// Exported for a caller that prints something before its first prompt: the
// header belongs to a wizard that cannot run at all here, so it should not be
// printed either.
export function assertInteractive(): void {
  if (!process.stdin.isTTY) throw new Error(NO_TTY_MESSAGE);
}

export const confirm: typeof rawConfirm = (...args) => {
  assertInteractive();
  return rawConfirm(...args);
};

export const input: typeof rawInput = (...args) => {
  assertInteractive();
  return rawInput(...args);
};

export const select: typeof rawSelect = (...args) => {
  assertInteractive();
  return rawSelect(...args);
};
