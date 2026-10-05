// The interactive session: `turbine` with no arguments in a terminal. The header, then a menu of the
// same actions the direct commands run. An action that fails shows its error and returns to the menu.
import type { Choice, Prompter } from "../wallet/signer.ts";

type SessionAction = Choice<string> & { run: () => Promise<void> };
type Session = {
  prompter: Prompter;
  header: () => Promise<void>;
  actions: () => readonly SessionAction[];
  fail: (error: unknown) => void;
  goodbye: () => void;
};

const QUIT = "quit";

async function runSession(session: Session): Promise<void> {
  await session.header();
  for (;;) {
    const actions = session.actions();
    const choice = await session.prompter.choose("What would you like to do?", [
      ...actions.map(({ value, label, hint }) => ({ value, label, hint })),
      { value: QUIT, label: "Quit" },
    ]);
    if (choice === undefined || choice === QUIT) break;
    const action = actions.find((a) => a.value === choice);
    try {
      await action?.run();
    } catch (error) {
      session.fail(error);
    }
  }
  session.goodbye();
}

export { runSession };
export type { SessionAction };
