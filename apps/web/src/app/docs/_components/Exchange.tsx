import { Code, JsonBlock } from "./Doc";
import { formatJson } from "./json";

const reasons: Record<number, string> = {
  200: "OK",
  201: "Created",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
};

function statusLine(status: number): string {
  return `HTTP/1.1 ${status} ${reasons[status] ?? ""}`.trimEnd();
}

/** A facilitator call as the resource SDK made it. The fixture body is the request body. */
export interface FacilitatorRecord {
  method: string;
  path: string;
  request?: unknown;
  status: number;
  response: unknown;
}

export function FacilitatorExchange({
  record,
  showRequest = true,
}: {
  record: FacilitatorRecord;
  showRequest?: boolean;
}) {
  const head = `${record.method} ${record.path}`;
  const request =
    record.request === undefined
      ? head
      : `${head}\nContent-Type: application/json\n\n${formatJson(record.request)}`;
  return (
    <>
      {showRequest ? <Code code={request} language="HTTP" name="Request" /> : null}
      <JsonBlock value={record.response} name={`Response, ${statusLine(record.status)}`} />
    </>
  );
}

/** A console backend call. Headers that carry live credentials are shown as placeholders. */
export interface ConsoleRecord {
  request: { method: string; path: string; headers?: Record<string, string>; body?: unknown };
  status: number;
  headers?: Record<string, string>;
  response: unknown;
}

export function ConsoleExchange({ record }: { record: ConsoleRecord }) {
  const { method, path, headers, body } = record.request;
  const lines = [`${method} ${path}`];
  for (const [name, value] of Object.entries(headers ?? {})) {
    lines.push(`${name.replace(/^./, (c) => c.toUpperCase())}: ${value}`);
  }
  if (body !== undefined) lines.push("Content-Type: application/json", "", formatJson(body));
  const responseHead = [statusLine(record.status)];
  for (const [name, value] of Object.entries(record.headers ?? {})) {
    responseHead.push(`${name}: ${value}`);
  }
  return (
    <>
      <Code code={lines.join("\n")} language="HTTP" name="Request" />
      {typeof record.response === "string" ? (
        <Code
          code={`${responseHead.join("\n")}\n\n${record.response}`}
          language="HTTP"
          name="Response"
        />
      ) : (
        <>
          {record.headers ? (
            <Code code={responseHead.join("\n")} language="HTTP" name="Response headers" />
          ) : null}
          <JsonBlock value={record.response} name={`Response, ${statusLine(record.status)}`} />
        </>
      )}
    </>
  );
}
