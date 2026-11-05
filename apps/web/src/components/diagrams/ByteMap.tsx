import styles from "./ByteMap.module.css";

export interface ByteField {
  name: string;
  bytes: number;
  /** Which colour group the field belongs to. */
  group: "domain" | "who" | "what" | "replay" | "when";
}

const groupLabels: Record<ByteField["group"], string> = {
  domain: "Binding",
  who: "Parties",
  what: "Payment",
  replay: "Replay",
  when: "Time",
};

/** An account or message drawn to scale, one block per field, with its total length. */
export function ByteMap({ fields, label }: { fields: readonly ByteField[]; label: string }) {
  const total = fields.reduce((sum, field) => sum + field.bytes, 0);
  const groups = [...new Set(fields.map((field) => field.group))];
  return (
    <figure className={styles.figure} aria-label={`${label}, ${total} bytes, drawn to scale.`}>
      <figcaption className={styles.head}>
        <code>{label}</code>
        <span>{total} bytes, to scale</span>
      </figcaption>
      <div className={styles.strip} aria-hidden="true">
        {fields.map((field) => (
          <span
            key={field.name}
            className={`${styles.cell} ${styles[field.group]}`}
            style={{ flexGrow: field.bytes }}
            title={`${field.name}, ${field.bytes} bytes`}
          />
        ))}
      </div>
      <dl className={styles.legend}>
        {groups.map((group) => (
          <div key={group} className={styles.group}>
            <dt>
              <span className={`${styles.swatch} ${styles[group]}`} aria-hidden="true" />
              {groupLabels[group]}
            </dt>
            {fields
              .filter((field) => field.group === group)
              .map((field) => (
                <dd key={field.name}>
                  <code>{field.name}</code>
                  <span>{field.bytes}</span>
                </dd>
              ))}
          </div>
        ))}
      </dl>
    </figure>
  );
}
