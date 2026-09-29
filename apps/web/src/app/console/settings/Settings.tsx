"use client";

import { explorerAddressUrl, networkByName } from "@turnstile/shared";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/Button";
import { CodeBlock } from "@/components/CodeBlock";
import { Field, Input } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { InlineStatus } from "@/components/InlineStatus";
import { StatusPill } from "@/components/StatusPill";
import { Table } from "@/components/Table";
import { useToast } from "@/components/Toast";
import { api, errorMessage, isUnauthenticated } from "@/lib/console/api";
import { useConsoleSession } from "@/lib/console/context";
import type { ApiKeyDto, CreatedApiKey } from "@/lib/console/types";
import { redirectToSignIn, useResource } from "@/lib/console/useResource";
import styles from "../_components/console.module.css";
import { dateTimeText } from "../_components/format";
import {
  ConsoleSection,
  EmptyState,
  LoadError,
  PageHeader,
  SkeletonRows,
} from "../_components/Page";
import page from "./settings.module.css";

function Address({ value, network }: { value: string; network: string }) {
  let href: string | null = null;
  try {
    href = explorerAddressUrl(networkByName(network), value);
  } catch {
    href = null;
  }
  if (!href) return <span className={styles.mono}>{value}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={page.address}>
      <span className={styles.mono}>{value}</span>
      <Icon name="external" size={14} />
      <span className="visually-hidden">(opens Solana Explorer in a new tab)</span>
    </a>
  );
}

function ApiKeys() {
  const toast = useToast();
  const keys = useResource<{ apiKeys: ApiKeyDto[] }>("/v1/api-keys");
  const [name, setName] = useState("");
  const [tried, setTried] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const nameError = !name.trim()
    ? "Name the key so you can tell it apart later, for example reporting job."
    : name.trim().length > 64
      ? "Keep the name to 64 characters or fewer."
      : undefined;

  async function create(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (nameError) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await api<CreatedApiKey>("/v1/api-keys", {
        method: "POST",
        body: { name: name.trim() },
      });
      setCreated(result);
      setName("");
      setTried(false);
      toast.show({ tone: "positive", title: "API key created", body: result.apiKey.name });
      keys.reload();
    } catch (error) {
      if (isUnauthenticated(error)) redirectToSignIn();
      setCreateError(errorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(key: ApiKeyDto) {
    setRevoking(key.id);
    setRevokeError(null);
    try {
      await api(`/v1/api-keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
      toast.show({ tone: "positive", title: "API key revoked", body: key.name });
      setConfirming(null);
      keys.reload();
    } catch (error) {
      if (isUnauthenticated(error)) redirectToSignIn();
      setRevokeError(errorMessage(error));
    } finally {
      setRevoking(null);
    }
  }

  const list = keys.data?.apiKeys ?? [];

  return (
    <ConsoleSection
      id="api-keys"
      title="API keys"
      note="Keys read receipts, spend and the summary from your own systems. They cannot change agents or policy."
    >
      <form className={`${styles.panel} ${page.create}`} onSubmit={create} noValidate>
        <Field
          label="Key name"
          error={tried ? nameError : undefined}
          help="Only you see it. Use what the key is for."
        >
          <Input
            value={name}
            maxLength={80}
            placeholder="reporting job"
            disabled={creating}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Button type="submit" loading={creating} loadingLabel="Creating API key" leadingIcon="key">
          Create API key
        </Button>
      </form>
      {createError ? (
        <InlineStatus tone="critical" title="API key not created">
          {createError}
        </InlineStatus>
      ) : null}

      {created ? (
        <div className={page.reveal}>
          <InlineStatus
            tone="caution"
            title="Copy this key now"
            action={
              <Button variant="secondary" size="sm" onClick={() => setCreated(null)}>
                I saved the key
              </Button>
            }
          >
            It is shown only once. The console keeps only a hash, so it cannot show it again. Send
            it as <code>Authorization: Bearer</code> followed by the key.
          </InlineStatus>
          <CodeBlock language={`API key, ${created.apiKey.name}`} code={created.key} />
        </div>
      ) : null}

      {keys.error ? (
        <LoadError what="API keys" error={keys.error} onRetry={keys.reload} />
      ) : !keys.data ? (
        <SkeletonRows rows={3} height="3rem" />
      ) : list.length === 0 ? (
        <EmptyState icon="key" title="No API keys yet">
          Keys you create appear here with their prefix, when they were last used and whether they
          still work. Create one to pull receipts into a report or a script.
        </EmptyState>
      ) : (
        <>
          <Table
            caption="API keys"
            columns={[
              { key: "name", label: "Name" },
              { key: "prefix", label: "Key", mono: true },
              { key: "created", label: "Created" },
              { key: "used", label: "Last used" },
              { key: "status", label: "State" },
              { key: "action", label: "Action" },
            ]}
            rows={list.map((k) => ({
              id: k.id,
              cells: {
                name: { value: k.name },
                prefix: { value: k.prefix, display: `${k.prefix}…` },
                created: {
                  value: k.createdAt,
                  display: <span className={page.nowrap}>{dateTimeText(k.createdAt)}</span>,
                },
                used: {
                  value: k.lastUsedAt,
                  display: (
                    <span className={page.nowrap}>
                      {k.lastUsedAt ? dateTimeText(k.lastUsedAt) : "Never"}
                    </span>
                  ),
                },
                status: {
                  value: k.status,
                  display:
                    k.status === "active" ? (
                      <StatusPill tone="positive">Active</StatusPill>
                    ) : (
                      <StatusPill tone="neutral">Revoked</StatusPill>
                    ),
                },
                action: {
                  value: null,
                  display:
                    k.status === "revoked" ? (
                      <span className={styles.faint}>
                        {k.revokedAt ? `Revoked ${dateTimeText(k.revokedAt)}` : ""}
                      </span>
                    ) : confirming === k.id ? (
                      <span className={page.confirm}>
                        <Button
                          size="sm"
                          variant="secondary"
                          className={page.danger}
                          loading={revoking === k.id}
                          loadingLabel="Revoking API key"
                          onClick={() => revoke(k)}
                        >
                          Revoke key
                        </Button>
                        <Button
                          size="sm"
                          variant="quiet"
                          disabled={revoking === k.id}
                          onClick={() => setConfirming(null)}
                        >
                          Keep it
                        </Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="quiet" onClick={() => setConfirming(k.id)}>
                        Revoke<span className="visually-hidden"> {k.name}</span>
                      </Button>
                    ),
                },
              },
            }))}
          />
          {confirming ? (
            <p className={page.warn} role="status">
              Anything still using this key stops working at once. This cannot be undone.
            </p>
          ) : null}
          {revokeError ? (
            <InlineStatus tone="critical" title="API key not revoked">
              {revokeError}
            </InlineStatus>
          ) : null}
        </>
      )}
    </ConsoleSection>
  );
}

export function Settings() {
  const { me, deployment } = useConsoleSession();
  return (
    <>
      <PageHeader
        title="Settings"
        lead="API keys for your own systems, and the account and network this console runs on."
      />
      <div className={styles.stack}>
        <ApiKeys />
        <div className={styles.twoCol}>
          <ConsoleSection id="account" title="Account">
            <dl className={`${styles.panel} ${styles.facts}`}>
              <div className={styles.fact}>
                <dt>Owner address</dt>
                <dd>
                  <Address value={me.owner} network={me.network} />
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>Signed in with</dt>
                <dd>
                  {me.authMethod === "session" ? "Wallet signature, 12 hour session" : "API key"}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>First sign in</dt>
                <dd>{me.createdAt ? dateTimeText(me.createdAt) : "Unknown"}</dd>
              </div>
              <div className={styles.fact}>
                <dt>Keys held by the console</dt>
                <dd>
                  None. Your wallet holds the owner key and each agent holds its own session key.
                </dd>
              </div>
            </dl>
          </ConsoleSection>
          <ConsoleSection id="network" title="Network">
            <dl className={`${styles.panel} ${styles.facts}`}>
              <div className={styles.fact}>
                <dt>Network</dt>
                <dd>{me.network}</dd>
              </div>
              <div className={styles.fact}>
                <dt>Agent wallet program</dt>
                <dd>
                  <Address value={deployment.programs.agentWallet} network={me.network} />
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>Settlement program</dt>
                <dd>
                  <Address value={deployment.programs.settlement} network={me.network} />
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>Stablecoin</dt>
                <dd>
                  {deployment.mint ? (
                    <>
                      {deployment.mintSymbol}, {deployment.mintDecimals} decimals
                      <br />
                      <Address value={deployment.mint} network={me.network} />
                    </>
                  ) : (
                    `${deployment.mintSymbol}, ${deployment.mintDecimals} decimals. The web server has no deployment file, so the mint address is not shown.`
                  )}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>Facilitator</dt>
                <dd>
                  {deployment.facilitator ? (
                    <Address value={deployment.facilitator} network={me.network} />
                  ) : (
                    "Not listed in the deployment file."
                  )}
                  {deployment.facilitatorUrl ? (
                    <>
                      <br />
                      <span className={styles.mono}>{deployment.facilitatorUrl}</span>
                    </>
                  ) : null}
                </dd>
              </div>
            </dl>
          </ConsoleSection>
        </div>
      </div>
    </>
  );
}
