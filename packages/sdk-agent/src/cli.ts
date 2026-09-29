#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TurnstileAgentError } from "./errors.js";
import { readKeypairFile, writeNewKeypairFile } from "./keys.js";

const USAGE = `turnstile-agent, helper for Turnstile agent operators

Usage
  turnstile-agent keygen --out <file>   create a new session key file with mode 600
  turnstile-agent address <file>        print the public key of a key file

keygen prints only the public key. Register that public key as a session key on
your agent wallet in the Turnstile console. The secret stays in the file.
`;

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

const processIo: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

/** Runs the CLI and returns the exit code. */
export function runCli(args: string[], io: CliIo = processIo): number {
  const [command, ...rest] = args;
  try {
    switch (command) {
      case "keygen": {
        const out = flag(rest, "--out");
        if (!out || out.startsWith("--")) {
          io.err("keygen needs --out <file>, the path for the new key file.");
          return 2;
        }
        const kp = writeNewKeypairFile(out);
        io.out(kp.publicKey.toBase58());
        return 0;
      }
      case "address": {
        const path = rest[0] ?? flag(rest, "--keypair");
        if (!path) {
          io.err("address needs the path of a key file.");
          return 2;
        }
        io.out(readKeypairFile(path).publicKey.toBase58());
        return 0;
      }
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.out(USAGE);
        return command === undefined ? 2 : 0;
      default:
        io.err(`Unknown command "${command}".`);
        io.err(USAGE);
        return 2;
    }
  } catch (err) {
    if (err instanceof TurnstileAgentError) {
      io.err(err.message);
      return 1;
    }
    throw err;
  }
}

function isEntryPoint(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return realpathSync(script) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

const invokedDirectly = isEntryPoint();

if (invokedDirectly) {
  process.exitCode = runCli(process.argv.slice(2));
}
