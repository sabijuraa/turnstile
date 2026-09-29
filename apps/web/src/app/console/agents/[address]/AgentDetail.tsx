"use client";

import { explorerAddressUrl, networkByName } from "@turnstile/shared";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button, ButtonLink } from "@/components/Button";
import { Field, Input } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { InlineStatus } from "@/components/InlineStatus";
import { PolicyPanel } from "@/components/PolicyPanel";
import { ReceiptList } from "@/components/ReceiptList";
import { SpendMeter } from "@/components/SpendMeter";
import { StatGrid, StatTile } from "@/components/StatTile";
import { StatusPill } from "@/components/StatusPill";
import { useToast } from "@/components/Toast";
import { api, errorMessage, query } from "@/lib/console/api";
import { useConsoleSession } from "@/lib/console/context";
import type { AgentDetail as Agent, ReceiptPage, SessionKeyDto } from "@/lib/console/types";
import { useChainAction } from "@/lib/console/useChainAction";
import { useResource } from "@/lib/console/useResource";
import { addressError, checkAmount, checkExpiry } from "@/lib/console/validate";
import { shortAddress } from "@/lib/format";
import { AgentStatusPill, agentStatusText } from "../../_components/AgentStatus";
import { ChainStatus } from "../../_components/ChainStatus";
import styles from "../../_components/console.module.css";
import { agentName, amountText, dateTimeText } from "../../_components/format";
import {
  ConsoleSection,
  LoadError,
  PageHeader,
  Skeleton,
  SkeletonRows,
} from "../../_components/Page";
import { toReceiptView } from "../../_components/receipts";
import detail from "./detail.module.css";

function MoveFunds({
  agent,
  kind,
  onDone,
}: {
  agent: Agent;
  kind: "deposit" | "withdraw";
  onDone: () => void;
}) {
  const { deployment } = useConsoleSession();
  const chain = useChainAction();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [tried, setTried] = useState(false);
  const check = checkAmount(amount, deployment.mintDecimals);
  const balance = BigInt(agent.vaultBalance.amount);
  const over = kind === "withdraw" && check.ok && check.units > balance;
  const error = !check.ok
    ? check.error
    : over
      ? `The vault holds ${amountText(agent.vaultBalance.displayAmount)} ${deployment.mintSymbol}. Withdraw at most that.`
      : undefined;
  const verb = kind === "deposit" ? "Deposit" : "Withdraw";
  const done = kind === "deposit" ? "Deposit confirmed" : "Withdrawal confirmed";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (error || !check.ok) return;
    const built = await chain.run(`/v1/tx/${kind}`, {
      agentWallet: agent.address,
      amount: amount.trim(),
    });
    if (built) {
      toast.show({
        tone: "positive",
        title: done,
        body: `${amount.trim()} ${deployment.mintSymbol}`,
      });
      setAmount("");
      setTried(false);
      onDone();
    }
  }

  return (
    <form className={styles.panel} onSubmit={submit} noValidate>
      <h3 className={detail.formTitle}>
        <Icon name={kind === "deposit" ? "coins" : "wallet"} size={18} />
        {kind === "deposit" ? "Deposit" : "Withdraw"}
      </h3>
      <Field
        label={`Amount to ${kind}`}
        help={
          kind === "deposit"
            ? `Moves ${deployment.mintSymbol} from your wallet into the agent vault.`
            : `Moves ${deployment.mintSymbol} from the vault back to your wallet.`
        }
        error={tried || amount.trim() ? error : undefined}
      >
        <Input
          mono
          inputMode="decimal"
          autoComplete="off"
          suffix={deployment.mintSymbol}
          value={amount}
          disabled={chain.pending}
          onChange={(e) => {
            setAmount(e.target.value);
            if (chain.state.phase === "confirmed" || chain.state.phase === "failed") chain.reset();
          }}
        />
      </Field>
      <div className={detail.formActions}>
        <Button
          type="submit"
          variant={kind === "deposit" ? "primary" : "secondary"}
          size="sm"
          loading={chain.pending}
          loadingLabel={kind === "deposit" ? "Depositing" : "Withdrawing"}
        >
          {verb}
        </Button>
        {kind === "withdraw" && balance > 0n ? (
          <Button
            variant="quiet"
            size="sm"
            disabled={chain.pending}
            onClick={() => setAmount(agent.vaultBalance.displayAmount)}
          >
            Use full balance
          </Button>
        ) : null}
      </div>
      <ChainStatus
        state={chain.state}
        done={done}
        failed={kind === "deposit" ? "Deposit failed" : "Withdrawal failed"}
      />
    </form>
  );
}

function keyTone(status: SessionKeyDto["status"]) {
  return status === "active" ? "positive" : status === "expired" ? "caution" : "neutral";
}

function SessionKeys({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const { me } = useConsoleSession();
  const toast = useToast();
  const revoke = useChainAction();
  const add = useChainAction();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [expiry, setExpiry] = useState("");
  const [tried, setTried] = useState(false);
  const expiryCheck = checkExpiry(expiry);
  const keyError =
    addressError(key, "session public key") ??
    (key.trim() === me.owner
      ? "Use a separate key for the agent, not your owner wallet."
      : undefined) ??
    (agent.sessionKeyList.some((k) => k.key === key.trim())
      ? "This key is already registered on the agent."
      : undefined);
  const activeCount = agent.sessionKeyList.filter((k) => k.status === "active").length;
  const slotsFree =
    agent.sessionKeyList.length < 4 || agent.sessionKeyList.some((k) => k.status !== "active");

  async function doRevoke(sessionKey: string) {
    setRevoking(sessionKey);
    const built = await revoke.run("/v1/tx/revoke-session-key", {
      agentWallet: agent.address,
      sessionKey,
    });
    setConfirming(null);
    if (built) {
      toast.show({
        tone: "positive",
        title: "Session key revoked",
        body: shortAddress(sessionKey, 6, 6),
      });
      onDone();
    }
  }

  async function doAdd(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (keyError || expiryCheck.error) return;
    const built = await add.run("/v1/tx/add-session-key", {
      agentWallet: agent.address,
      sessionKey: key.trim(),
      expiresAt: expiryCheck.iso,
    });
    if (built) {
      toast.show({
        tone: "positive",
        title: "Session key added",
        body: shortAddress(key.trim(), 6, 6),
      });
      setKey("");
      setExpiry("");
      setTried(false);
      onDone();
    }
  }

  return (
    <div className={styles.twoCol}>
      <div className={styles.panel}>
        <h3 className={detail.formTitle}>
          <Icon name="key" size={18} />
          Registered keys
          <span className={detail.count}>
            {activeCount} active of {agent.sessionKeyList.length}
          </span>
        </h3>
        {agent.sessionKeyList.length === 0 ? (
          <p className={styles.faint}>No session keys. Add one so the agent can sign payments.</p>
        ) : (
          <ul className={detail.keys}>
            {agent.sessionKeyList.map((k) => (
              <li key={k.key} className={detail.key}>
                <div className={detail.keyMain}>
                  <span className={styles.mono}>{k.key}</span>
                  <span className={styles.faint}>
                    {k.expiresAt ? `Expires ${dateTimeText(k.expiresAt)}` : "No expiry"}
                  </span>
                </div>
                <div className={detail.keyActions}>
                  <StatusPill
                    tone={keyTone(k.status)}
                    icon={k.status === "revoked" ? null : undefined}
                  >
                    {k.status === "active"
                      ? "Active"
                      : k.status === "expired"
                        ? "Expired"
                        : "Revoked"}
                  </StatusPill>
                  {k.status !== "revoked" ? (
                    confirming === k.key ? (
                      <span className={detail.confirm}>
                        <Button
                          size="sm"
                          variant="secondary"
                          className={detail.danger}
                          loading={revoke.pending && revoking === k.key}
                          loadingLabel="Revoking session key"
                          onClick={() => doRevoke(k.key)}
                        >
                          Revoke key
                        </Button>
                        <Button
                          size="sm"
                          variant="quiet"
                          disabled={revoke.pending}
                          onClick={() => setConfirming(null)}
                        >
                          Keep it
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={revoke.pending}
                        onClick={() => {
                          revoke.reset();
                          setConfirming(k.key);
                        }}
                      >
                        Revoke<span className="visually-hidden"> key {shortAddress(k.key)}</span>
                      </Button>
                    )
                  ) : null}
                </div>
                {confirming === k.key && !revoke.pending ? (
                  <p className={detail.confirmText}>
                    The agent can no longer sign payments with this key. This cannot be undone.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <ChainStatus
          state={revoke.state}
          done="Session key revoked"
          failed="Session key not revoked"
        />
      </div>

      <form className={styles.panel} onSubmit={doAdd} noValidate>
        <h3 className={detail.formTitle}>
          <Icon name="key" size={18} />
          Add session key
        </h3>
        <p className={styles.faint}>
          Generate it where the agent runs with{" "}
          <code>npx turnstile-agent keygen --out session.json</code> and paste the public key. Up to
          four keys fit on one agent.
        </p>
        <Field
          label="Session public key"
          error={tried || key.trim() ? keyError : undefined}
          required
        >
          <Input
            mono
            autoComplete="off"
            spellCheck={false}
            value={key}
            disabled={add.pending}
            placeholder="Paste the public key"
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        <Field
          label="Key expires"
          hint="Optional"
          help="Your local time. Leave empty for no expiry."
          error={expiryCheck.error}
        >
          <Input
            type="datetime-local"
            value={expiry}
            disabled={add.pending}
            onChange={(e) => setExpiry(e.target.value)}
          />
        </Field>
        {!slotsFree ? (
          <InlineStatus tone="caution" title="All four key slots are active">
            Revoke a key before you add another.
          </InlineStatus>
        ) : null}
        <div className={detail.formActions}>
          <Button
            type="submit"
            size="sm"
            loading={add.pending}
            loadingLabel="Adding session key"
            disabled={!slotsFree}
          >
            Add session key
          </Button>
        </div>
        <ChainStatus state={add.state} done="Session key added" failed="Session key not added" />
      </form>
    </div>
  );
}

function Rename({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(agent.label ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();
  const invalid = !trimmed
    ? "Enter a name."
    : trimmed.length > 64
      ? "Keep the name to 64 characters or fewer."
      : undefined;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/v1/agents/${agent.address}/label`, { method: "PUT", body: { label: trimmed } });
      toast.show({ tone: "positive", title: "Name saved", body: trimmed });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={detail.rename} onSubmit={save} noValidate>
      <Field
        label="Agent name"
        help="Shown in the console and in exports. Not stored on chain."
        error={error ?? undefined}
      >
        <Input value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={saving}
        loadingLabel="Saving name"
      >
        Save name
      </Button>
    </form>
  );
}

function CloseWallet({ agent }: { agent: Agent }) {
  const router = useRouter();
  const toast = useToast();
  const chain = useChainAction();
  const [confirming, setConfirming] = useState(false);
  const { deployment } = useConsoleSession();
  const hasFunds = BigInt(agent.vaultBalance.amount) > 0n;

  async function close() {
    const built = await chain.run("/v1/tx/close-wallet", {
      agentWallet: agent.address,
      withdrawRemaining: true,
    });
    if (built) {
      toast.show({ tone: "positive", title: "Agent wallet closed", body: agentName(agent) });
      router.push("/console/agents");
    }
  }

  return (
    <div className={`${styles.panel} ${detail.dangerPanel}`}>
      <p className={styles.muted}>
        Closing returns{" "}
        {hasFunds
          ? `the ${amountText(agent.vaultBalance.displayAmount)} ${deployment.mintSymbol} left in the vault and `
          : ""}
        the account rent to your wallet. Receipts stay on chain. The agent can never pay from this
        wallet again.
      </p>
      <div className={detail.formActions}>
        {confirming ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              className={detail.danger}
              onClick={close}
              loading={chain.pending}
              loadingLabel="Closing agent wallet"
            >
              Close agent wallet
            </Button>
            <Button
              variant="quiet"
              size="sm"
              disabled={chain.pending}
              onClick={() => setConfirming(false)}
            >
              Keep it open
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            Close agent wallet
          </Button>
        )}
      </div>
      <ChainStatus
        state={chain.state}
        done="Agent wallet closed"
        failed="Agent wallet not closed"
      />
    </div>
  );
}

export function AgentDetail({ address }: { address: string }) {
  const { me, deployment } = useConsoleSession();
  const asset = deployment.mintSymbol;
  const agent = useResource<{ agent: Agent }>(`/v1/agents/${address}`);
  const receipts = useResource<ReceiptPage>(`/v1/receipts${query({ agent: address, limit: 8 })}`);
  const a = agent.data?.agent;

  if (agent.error) {
    return (
      <>
        <PageHeader title="Agent" back={{ href: "/console/agents", label: "Agents" }} />
        <LoadError what="This agent" error={agent.error} onRetry={agent.reload} />
      </>
    );
  }

  if (!a) {
    return (
      <div aria-busy="true" style={{ display: "grid", gap: "var(--space-6)" }}>
        <span className="visually-hidden">Loading the agent</span>
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Skeleton width="5rem" height="1.25rem" />
          <Skeleton width="16rem" height="2.5rem" />
          <Skeleton width="24rem" height="1.25rem" style={{ maxWidth: "100%" }} />
        </div>
        <Skeleton height="8.5rem" />
        <SkeletonRows rows={2} height="12rem" />
      </div>
    );
  }

  const reload = () => {
    agent.reload();
    receipts.reload();
  };

  return (
    <>
      <PageHeader
        title={agentName(a)}
        back={{ href: "/console/agents", label: "Agents" }}
        lead={
          <span className={detail.lead}>
            <AgentStatusPill status={a.status} />
            <a
              href={explorerAddressUrl(networkByName(me.network), a.address)}
              target="_blank"
              rel="noreferrer"
              className={detail.addressLink}
            >
              <span className={styles.mono}>{a.address}</span>
              <Icon name="external" size={14} />
              <span className="visually-hidden">
                View the agent wallet on Solana Explorer (opens in a new tab)
              </span>
            </a>
          </span>
        }
        actions={
          <ButtonLink
            href={`/console/agents/${a.address}/policy`}
            leadingIcon="shield"
            variant="secondary"
          >
            Edit policy
          </ButtonLink>
        }
      />

      <div className={styles.stack}>
        {a.attention.length > 0 ? (
          <InlineStatus
            tone={a.status === "at_cap" || a.status === "no_active_key" ? "critical" : "caution"}
            title={agentStatusText(a.status)}
          >
            {a.attention.includes("no_active_key")
              ? "Add a session key so the agent can sign payments. "
              : ""}
            {a.attention.includes("unfunded") ? "Deposit funds so payments can settle. " : ""}
            {a.attention.includes("no_allow_list")
              ? "Add a service to the allow-list. Until then every payment is refused. "
              : ""}
            {a.attention.includes("at_cap")
              ? "Payments are refused until older spend leaves the 24 hour window, or you raise the daily cap. "
              : ""}
            {a.attention.includes("near_cap") ? "The agent has used most of its daily cap. " : ""}
          </InlineStatus>
        ) : null}

        <StatGrid label="Agent figures">
          <StatTile
            label="Vault balance"
            icon="wallet"
            value={amountText(a.vaultBalance.displayAmount)}
            unit={asset}
          />
          <StatTile
            label="Spend, last 24 hours"
            icon="clock"
            value={amountText(a.rollingSpend.displayAmount)}
            unit={asset}
            detail={`Of a ${amountText(a.dailyCap.displayAmount)} daily cap`}
            tone={
              a.status === "at_cap" ? "critical" : a.status === "near_cap" ? "caution" : "neutral"
            }
          />
          <StatTile
            label="Total spent"
            icon="coins"
            value={amountText(a.totalSpent.displayAmount)}
            unit={asset}
          />
          <StatTile
            label="Settlements"
            icon="receipt"
            value={a.settlementCount}
            detail={`Since ${dateTimeText(a.createdAt)}`}
          />
        </StatGrid>

        <ConsoleSection
          id="policy"
          title="Policy"
          note="The chain checks these rules on every payment."
        >
          <PolicyPanel
            title={agentName(a)}
            perCallCap={amountText(a.perCallCap.displayAmount)}
            dailyCap={amountText(a.dailyCap.displayAmount)}
            asset={asset}
            allowList={a.allowList.map((e) => ({
              resource: e.resource ?? `Resource id ${shortAddress(e.resourceId, 8, 8)}`,
              recipient: shortAddress(e.recipient, 6, 6),
            }))}
            sessionKey={`${a.sessionKeys.active} active of ${a.sessionKeys.total}`}
            meter={
              <SpendMeter
                label="Daily cap, rolling 24 hours"
                spent={BigInt(a.rollingSpend.amount)}
                cap={BigInt(a.dailyCap.amount)}
                decimals={deployment.mintDecimals}
                asset={asset}
              />
            }
            action={
              <ButtonLink
                href={`/console/agents/${a.address}/policy`}
                size="sm"
                variant="quiet"
                icon="arrowRight"
              >
                Edit policy
              </ButtonLink>
            }
            headingLevel={3}
          />
        </ConsoleSection>

        <ConsoleSection
          id="funds"
          title="Funds"
          note={`The vault holds ${amountText(a.vaultBalance.displayAmount)} ${asset}.`}
        >
          <div className={styles.twoCol}>
            <MoveFunds agent={a} kind="deposit" onDone={reload} />
            <MoveFunds agent={a} kind="withdraw" onDone={reload} />
          </div>
        </ConsoleSection>

        <ConsoleSection
          id="keys"
          title="Session keys"
          note="The agent signs payments with a session key. Revoke one the moment you stop trusting it."
        >
          <SessionKeys agent={a} onDone={reload} />
        </ConsoleSection>

        <ConsoleSection
          id="receipts"
          title="Recent receipts"
          action={
            <a href={`/console/receipts${query({ agent: a.address })}`} className={styles.textLink}>
              All receipts for this agent
              <Icon name="arrowRight" size={14} />
            </a>
          }
        >
          {receipts.error ? (
            <LoadError what="Receipts" error={receipts.error} onRetry={receipts.reload} />
          ) : receipts.data ? (
            <ReceiptList
              label={`Recent receipts for ${agentName(a)}`}
              receipts={receipts.data.receipts.map((r) => toReceiptView(r, asset))}
              empty={
                <p>
                  No receipts yet. Each payment this agent makes lands here once it settles on
                  chain.
                </p>
              }
            />
          ) : (
            <SkeletonRows rows={3} height="4.25rem" />
          )}
        </ConsoleSection>

        <ConsoleSection id="details" title="Details">
          <div className={styles.twoCol}>
            <div className={styles.panel}>
              <Rename agent={a} onDone={agent.reload} />
            </div>
            <div className={styles.panel}>
              <dl className={styles.facts}>
                <div className={styles.fact}>
                  <dt>Wallet id</dt>
                  <dd className={styles.mono}>{a.id}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Vault</dt>
                  <dd className={styles.mono}>{a.vault}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Mint</dt>
                  <dd className={styles.mono}>{a.mint}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Owner</dt>
                  <dd className={styles.mono}>{a.owner}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Created</dt>
                  <dd>{dateTimeText(a.createdAt)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </ConsoleSection>

        <ConsoleSection id="close" title="Close agent wallet">
          <CloseWallet agent={a} />
        </ConsoleSection>
      </div>
    </>
  );
}
