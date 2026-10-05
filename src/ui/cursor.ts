// The terminal cursor, tracked so it can be given back however turbine-cli stops: after an animation,
// on an error, or on Ctrl-C (the signal handler in main.ts calls restore()).
type Cursor = { hide(): void; show(): void; restore(): void };

const HIDE = "\u001b[?25l";
const SHOW = "\u001b[?25h";

function createCursor(write: (text: string) => void): Cursor {
  let hidden = false;
  const show = () => {
    if (!hidden) return;
    hidden = false;
    write(SHOW);
  };
  return {
    hide() {
      if (hidden) return;
      hidden = true;
      write(HIDE);
    },
    show,
    restore: show,
  };
}

export { createCursor };
export type { Cursor };
