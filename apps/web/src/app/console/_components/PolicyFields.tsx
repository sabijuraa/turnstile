"use client";

import { useId } from "react";
import { Button } from "@/components/Button";
import { Field, Input } from "@/components/Field";
import { Icon } from "@/components/Icon";
import {
  type AllowDraft,
  type AllowErrors,
  checkAllowList,
  checkAmount,
  checkCaps,
  checkResource,
  MAX_ALLOW_LIST_ENTRIES,
} from "@/lib/console/validate";
import styles from "./PolicyFields.module.css";

export interface PolicyDraft {
  perCallCap: string;
  dailyCap: string;
  allowList: AllowDraft[];
}

export interface PolicyErrors {
  perCallCap?: string;
  dailyCap?: string;
  allow: Record<string, AllowErrors>;
  listError?: string;
}

export interface PolicyBody {
  perCallCap: string;
  dailyCap: string;
  allowList: { resource: string; recipient: string }[];
}

let rowCounter = 0;
export function newAllowRow(resource = "", recipient = ""): AllowDraft {
  rowCounter += 1;
  return { key: `row-${rowCounter}`, resource, recipient };
}

/** Checks the whole policy the way the agent wallet program will. */
export function validatePolicy(
  draft: PolicyDraft,
  decimals: number,
): { errors: PolicyErrors; body: PolicyBody | null } {
  const perCall = checkAmount(draft.perCallCap, decimals, {
    allowZero: true,
    label: "the per-call cap",
  });
  const daily = checkAmount(draft.dailyCap, decimals, { allowZero: true, label: "the daily cap" });
  const allow = checkAllowList(draft.allowList);
  const errors: PolicyErrors = {
    perCallCap: perCall.ok ? checkCaps(perCall, daily, decimals) : perCall.error,
    dailyCap: daily.ok ? undefined : daily.error,
    allow: allow.errors,
    listError: allow.listError,
  };
  const valid =
    !errors.perCallCap &&
    !errors.dailyCap &&
    !errors.listError &&
    Object.keys(errors.allow).length === 0;
  return {
    errors,
    body: valid
      ? {
          perCallCap: draft.perCallCap.trim(),
          dailyCap: draft.dailyCap.trim(),
          allowList: draft.allowList.map((r) => ({
            resource: r.resource.trim(),
            recipient: r.recipient.trim(),
          })),
        }
      : null,
  };
}

function ResourcePreview({ value }: { value: string }) {
  const check = checkResource(value);
  if (!value.trim() || !check.ok) return null;
  if (check.idOnly) {
    return (
      <span className={styles.preview}>
        Stored as a resource id. The console does not know its URL.
      </span>
    );
  }
  return (
    <span className={styles.preview}>
      Hashed on chain as <span className={styles.canonical}>{check.canonical}</span>
    </span>
  );
}

/**
 * Per-call cap, daily cap and allow-list controls that read like a permissions panel.
 * Errors show for fields the person has left or after they try to submit.
 */
export function PolicyFields({
  draft,
  onChange,
  errors,
  showErrors,
  asset,
  disabled = false,
}: {
  draft: PolicyDraft;
  onChange: (next: PolicyDraft) => void;
  errors: PolicyErrors;
  showErrors: boolean;
  asset: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const full = draft.allowList.length >= MAX_ALLOW_LIST_ENTRIES;
  // Errors show as soon as a field holds something, and for empty fields once submit was tried.
  const show = (value: string) => showErrors || value.trim() !== "";

  function setRow(key: string, patch: Partial<AllowDraft>) {
    onChange({
      ...draft,
      allowList: draft.allowList.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    });
  }

  return (
    <div className={styles.policy}>
      <div className={styles.caps}>
        <Field
          label="Per-call cap"
          help="The most one paid request can cost. The program refuses anything above it."
          error={show(draft.perCallCap) ? errors.perCallCap : undefined}
          required
        >
          <Input
            mono
            inputMode="decimal"
            autoComplete="off"
            suffix={asset}
            value={draft.perCallCap}
            placeholder="0.01"
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, perCallCap: e.target.value })}
          />
        </Field>
        <Field
          label="Daily cap"
          help="The most the agent can spend in any rolling 24 hours."
          error={show(draft.dailyCap) ? errors.dailyCap : undefined}
          required
        >
          <Input
            mono
            inputMode="decimal"
            autoComplete="off"
            suffix={asset}
            value={draft.dailyCap}
            placeholder="5"
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, dailyCap: e.target.value })}
          />
        </Field>
      </div>

      <fieldset className={styles.allow} disabled={disabled} aria-describedby={`${listId}-help`}>
        <legend className={styles.allowLegend}>
          <Icon name="list" size={16} />
          Allow-list
          <span className={styles.count}>
            {draft.allowList.length} of {MAX_ALLOW_LIST_ENTRIES}
          </span>
        </legend>
        <p id={`${listId}-help`} className={styles.allowHelp}>
          The agent can pay only these routes, and only to the recipient you pair with each one. An
          empty list lets it pay nothing.
        </p>
        {draft.allowList.length > 0 ? (
          <ol className={styles.rows}>
            {draft.allowList.map((row, index) => {
              const rowErrors = errors.allow[row.key];
              return (
                <li key={row.key} className={styles.row}>
                  <span className={styles.index} aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className={styles.rowFields}>
                    <Field
                      label={`Resource URL ${index + 1}`}
                      error={show(row.resource) ? rowErrors?.resource : undefined}
                      help={<ResourcePreview value={row.resource} />}
                    >
                      <Input
                        mono
                        type="text"
                        inputMode="url"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="https://api.example.com/v1/summarize"
                        value={row.resource}
                        onChange={(e) => setRow(row.key, { resource: e.target.value })}
                      />
                    </Field>
                    <Field
                      label={`Recipient address ${index + 1}`}
                      error={show(row.recipient) ? rowErrors?.recipient : undefined}
                    >
                      <Input
                        mono
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="Wallet that receives the payment"
                        value={row.recipient}
                        onChange={(e) => setRow(row.key, { recipient: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Button
                    variant="quiet"
                    size="sm"
                    className={styles.remove}
                    onClick={() =>
                      onChange({
                        ...draft,
                        allowList: draft.allowList.filter((r) => r.key !== row.key),
                      })
                    }
                  >
                    Remove<span className="visually-hidden"> entry {index + 1}</span>
                  </Button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={styles.emptyList}>No services yet. This agent can pay nothing.</p>
        )}
        {errors.listError ? (
          <p className={styles.listError} role="alert">
            <Icon name="alert" size={16} />
            {errors.listError}
          </p>
        ) : null}
        <div>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon="endpoint"
            disabled={full}
            onClick={() => onChange({ ...draft, allowList: [...draft.allowList, newAllowRow()] })}
          >
            Add service
          </Button>
          {full ? (
            <span className={styles.fullNote}>
              One policy change holds {MAX_ALLOW_LIST_ENTRIES} entries.
            </span>
          ) : null}
        </div>
      </fieldset>
    </div>
  );
}
