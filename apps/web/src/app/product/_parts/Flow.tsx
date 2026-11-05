import { ByteMap } from "@/components/diagrams/ByteMap";
import { messageFields } from "@/components/diagrams/receiptFields";
import { Section } from "@/components/Section";

export function Flow() {
  return (
    <Section
      id="signature"
      tone="surface"
      eyebrow="The signature"
      title="The key signs one exact payment."
      lead="Amount, recipient, route, nonce and expiry all sit inside the signed bytes, so nobody passing it along can change them. The program id ties it to this program alone."
    >
      <ByteMap fields={messageFields} label="Signed message" />
    </Section>
  );
}
