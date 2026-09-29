"use client";

import { useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/Button";
import { CodeBlock } from "@/components/CodeBlock";
import { Field, Input } from "@/components/Field";
import { InlineStatus } from "@/components/InlineStatus";
import { useToast } from "@/components/Toast";
import { api, errorMessage } from "@/lib/console/api";
import { useConsoleSession } from "@/lib/console/context";
import { useChainAction } from "@/lib/console/useChainAction";
import { addressError, checkAmount, checkExpiry } from "@/lib/console/validate";
import { ChainStatus } from "../../_components/ChainStatus";
import styles from "../../_components/console.module.css";
import { amountText } from "../../_components/format";
import { PageHeader } from "../../_components/Page";
import { type PolicyDraft, PolicyFields, validatePolicy } from "../../_components/PolicyFields";
import flow from "./create.module.css";

const steps = ["Owner", "Session key", "Funding", "Limits", "Review"] as const;

export function CreateAgent() {
  const { me, deployment } = useConsoleSession();
  const asset = deployment.mintSymbol;
  const decimals = deployment.mintDecimals;
  const toast = useToast();
  const chain = useChainAction();

  const [step, setStep] = useState(0);
  const [tried, setTried] = useState<Set<number>>(new Set());
  const [label, setLabel] = useState("");
  const [sessionKey, setSessionKey] = useState("");
  const [expiry, setExpiry] = useState("");
  const [deposit, setDeposit] = useState("");
  const [policy, setPolicy] = useState<PolicyDraft>({
    perCallCap: "",
    dailyCap: "",
    allowList: [],
  });
  const [created, setCreated] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  function goTo(index: number) {
    setStep(index);
    requestAnimationFrame(() => heading.current?.focus());
  }

  const keyError =
    addressError(sessionKey, "session public key") ??
    (sessionKey.trim() === me.owner
      ? "Use a separate key for the agent, not your owner wallet. Generate one with the command above."
      : undefined);
  const expiryCheck = checkExpiry(expiry);
  const depositCheck = deposit.trim()
    ? checkAmount(deposit, decimals, { label: "the deposit" })
    : ({ ok: true, units: 0n } as const);
  const policyCheck = validatePolicy(policy, decimals);
  const labelTooLong =
    label.trim().length > 64 ? "Keep the name to 64 characters or fewer." : undefined;

  const stepValid = [
    !labelTooLong,
    !keyError && !expiryCheck.error,
    depositCheck.ok,
    policyCheck.body !== null,
    true,
  ];
  const show = (i: number) => tried.has(i);

  function next() {
    setTried((t) => new Set(t).add(step));
    if (!stepValid[step]) return;
    goTo(Math.min(steps.length - 1, step + 1));
  }

  async function submit() {
    if (!policyCheck.body || keyError || !depositCheck.ok) return;
    const built = await chain.run("/v1/tx/create-agent", {
      sessionKey: sessionKey.trim(),
      sessionExpiresAt: expiryCheck.iso,
      perCallCap: policyCheck.body.perCallCap,
      dailyCap: policyCheck.body.dailyCap,
      deposit: depositCheck.units > 0n ? deposit.trim() : undefined,
      allowList: policyCheck.body.allowList,
    });
    if (!built) return;
    setCreated(built.agentWallet);
    if (label.trim()) {
      try {
        await api(`/v1/agents/${built.agentWallet}/label`, {
          method: "PUT",
          body: { label: label.trim() },
        });
      } catch (error) {
        setLabelError(errorMessage(error));
      }
    }
    toast.show({ tone: "positive", title: "Agent created", body: label.trim() || undefined });
  }

  const locked = chain.pending || created !== null;

  return (
    <>
      <PageHeader
        title="Create agent"
        lead="Set up a wallet your agent pays from. Your wallet stays the owner and signs every change."
        back={{ href: "/console/agents", label: "Agents" }}
      />

      <div className={flow.layout}>
        <ol className={flow.steps} aria-label="Steps">
          {steps.map((name, i) => (
            <li
              key={name}
              className={flow.step}
              data-state={i < step ? "done" : i === step ? "current" : "todo"}
              aria-current={i === step ? "step" : undefined}
            >
              <span className={flow.stepNumber} aria-hidden="true">
                {i + 1}
              </span>
              <span>{name}</span>
              {i < step ? <span className="visually-hidden">, done</span> : null}
            </li>
          ))}
        </ol>

        <section className={`${styles.panel} ${flow.card}`} aria-labelledby="step-title">
          <p className={flow.kicker}>
            Step {step + 1} of {steps.length}
          </p>
          <h2 id="step-title" className={flow.title} ref={heading} tabIndex={-1}>
            {step === 0 && "Confirm the owner"}
            {step === 1 && "Register the agent's session key"}
            {step === 2 && "Fund the agent"}
            {step === 3 && "Set its limits"}
            {step === 4 && "Review and create"}
          </h2>

          {step === 0 ? (
            <div className={flow.body}>
              <p className={styles.muted}>
                The owner authority is the wallet you signed in with. Only it can fund the agent,
                change its policy, rotate its keys or withdraw.
              </p>
              <dl className={styles.facts}>
                <div className={styles.fact}>
                  <dt>Owner authority</dt>
                  <dd className={styles.mono}>{me.owner}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Network</dt>
                  <dd>{me.network}</dd>
                </div>
              </dl>
              <Field
                label="Agent name"
                hint="Optional"
                help="Shown in the console only. It is not stored on chain."
                error={labelTooLong}
              >
                <Input
                  value={label}
                  maxLength={80}
                  placeholder="Research agent"
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
            </div>
          ) : null}

          {step === 1 ? (
            <div className={flow.body}>
              <p className={styles.muted}>
                The agent signs each payment with its own session key. Generate it where the agent
                runs and paste only the public key here. The console never creates or sees the
                private key.
              </p>
              <CodeBlock language="Shell" code="npx turnstile-agent keygen --out session.json" />
              <Field
                label="Session public key"
                help="The keygen command prints it. It is a base58 address."
                error={show(1) || sessionKey.trim() ? keyError : undefined}
                required
              >
                <Input
                  mono
                  autoComplete="off"
                  spellCheck={false}
                  value={sessionKey}
                  placeholder="Paste the public key"
                  onChange={(e) => setSessionKey(e.target.value)}
                />
              </Field>
              <Field
                label="Key expires"
                hint="Optional"
                help="After this time the key cannot authorize payments. Leave empty for no expiry. Your local time."
                error={expiryCheck.error}
              >
                <Input
                  type="datetime-local"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </Field>
            </div>
          ) : null}

          {step === 2 ? (
            <div className={flow.body}>
              <p className={styles.muted}>
                Move {asset} from your wallet into the agent's vault in the same transaction. You
                can deposit more or withdraw at any time.
              </p>
              <Field
                label="Initial deposit"
                hint="Optional"
                help={`Up to ${decimals} decimal places. Leave empty to fund it later.`}
                error={deposit.trim() && !depositCheck.ok ? depositCheck.error : undefined}
              >
                <Input
                  mono
                  inputMode="decimal"
                  autoComplete="off"
                  suffix={asset}
                  value={deposit}
                  placeholder="10"
                  onChange={(e) => setDeposit(e.target.value)}
                />
              </Field>
            </div>
          ) : null}

          {step === 3 ? (
            <div className={flow.body}>
              <p className={styles.muted}>
                The chain checks these on every payment. A payment over a cap or to a route that is
                not listed fails at the program, whatever any service claims.
              </p>
              <PolicyFields
                draft={policy}
                onChange={setPolicy}
                errors={policyCheck.errors}
                showErrors={show(3)}
                asset={asset}
              />
            </div>
          ) : null}

          {step === 4 ? (
            <div className={flow.body}>
              <dl className={styles.facts}>
                <div className={styles.fact}>
                  <dt>Name</dt>
                  <dd>{label.trim() || "None"}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Owner authority</dt>
                  <dd className={styles.mono}>{me.owner}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Session key</dt>
                  <dd className={styles.mono}>{sessionKey.trim()}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Key expires</dt>
                  <dd>{expiryCheck.iso ? new Date(expiryCheck.iso).toLocaleString() : "Never"}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Initial deposit</dt>
                  <dd className={styles.mono}>
                    {depositCheck.ok && depositCheck.units > 0n
                      ? `${amountText(deposit.trim())} ${asset}`
                      : "None"}
                  </dd>
                </div>
                <div className={styles.fact}>
                  <dt>Per-call cap</dt>
                  <dd className={styles.mono}>
                    {amountText(policy.perCallCap.trim())} {asset}
                  </dd>
                </div>
                <div className={styles.fact}>
                  <dt>Daily cap</dt>
                  <dd className={styles.mono}>
                    {amountText(policy.dailyCap.trim())} {asset}
                  </dd>
                </div>
                <div className={styles.fact}>
                  <dt>Allow-list</dt>
                  <dd>
                    {policy.allowList.length === 0 ? (
                      "Empty. The agent can pay nothing until you add a service."
                    ) : (
                      <ul className={flow.allowSummary}>
                        {policy.allowList.map((r) => (
                          <li key={r.key} className={styles.mono}>
                            {r.resource.trim()} to {r.recipient.trim()}
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </div>
              </dl>
              <p className={styles.faint}>
                Your wallet signs as the owner and pays the network fee and the account rent.
              </p>
              <ChainStatus state={chain.state} done="Agent created" failed="Agent not created" />
              {labelError ? (
                <InlineStatus tone="caution" title="Name not saved">
                  {labelError} You can name the agent on its page.
                </InlineStatus>
              ) : null}
            </div>
          ) : null}

          <div className={flow.actions}>
            {created ? (
              <ButtonLink href={`/console/agents/${created}`} icon="arrowRight">
                Open agent
              </ButtonLink>
            ) : step < steps.length - 1 ? (
              <Button onClick={next} icon="arrowRight">
                Continue
              </Button>
            ) : (
              <Button onClick={submit} loading={chain.pending} loadingLabel="Creating agent">
                Create agent
              </Button>
            )}
            {step > 0 && !created ? (
              <Button variant="secondary" onClick={() => goTo(step - 1)} disabled={locked}>
                Back
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
