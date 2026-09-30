import type { ReactNode } from "react";
import capture from "../_examples/capture.json";
import { Note } from "./Doc";

const captured = new Date(capture.capturedAt);
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The capture date in UTC, with fixed month names so server and browser agree. */
export const capturedOn = `${captured.getUTCDate()} ${months[captured.getUTCMonth()]} ${captured.getUTCFullYear()}`;

/** Marks an example as captured from a real local run rather than written by hand. */
export function CapturedNote({ children }: { children?: ReactNode }) {
  return (
    <Note>
      <p>
        Captured from a local validator run on {capturedOn}, not written by hand.
        {children ? " " : null}
        {children}
      </p>
    </Note>
  );
}
