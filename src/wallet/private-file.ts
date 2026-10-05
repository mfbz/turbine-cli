// Reads a small file that must be only its owner's (a wallet or a password file) without the usual
// races: it is opened once, without following a symlink and without blocking on a pipe, and the checks
// run on that open file, so it can't be swapped between the check and the read.
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";

import { CliError } from "../output/errors.ts";
import type { ErrorCode } from "../output/errors.ts";

type Codes = { unreadable: ErrorCode; tooOpen: ErrorCode; invalid: ErrorCode };

// Group and others: any of their read, write or execute bits.
const NOT_OWNER_ONLY = 0o077;
// Flags that don't exist on a platform (O_NOFOLLOW, O_NONBLOCK on Windows) are simply left out.
const FLAGS =
  constants.O_RDONLY |
  (constants.O_NOFOLLOW ?? 0) |
  (constants.O_NONBLOCK ?? 0);

function readPrivateFile(
  path: string,
  options: { maxBytes: number; platform: NodeJS.Platform; codes: Codes }
): string {
  const params = { path };
  let fd: number;
  try {
    fd = openSync(path, FLAGS);
  } catch (error) {
    // ELOOP: the path is a symlink, which a private file never needs to be.
    const code = (error as NodeJS.ErrnoException).code;
    throw new CliError(
      code === "ELOOP" ? options.codes.invalid : options.codes.unreadable,
      params,
      { cause: error }
    );
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > options.maxBytes)
      throw new CliError(options.codes.invalid, params);
    // Windows has no POSIX modes; NTFS permissions are the user's to set.
    if (options.platform !== "win32" && (stat.mode & NOT_OWNER_ONLY) !== 0)
      throw new CliError(options.codes.tooOpen, params);
    return readFileSync(fd, "utf8");
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(options.codes.unreadable, params, { cause: error });
  } finally {
    closeSync(fd);
  }
}

export { readPrivateFile };
