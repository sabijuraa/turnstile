import { CornerShapes } from "@/components/art/scenes";
import { ButtonLink } from "@/components/Button";
import { ClosingBand } from "@/components/Feature";

export function ClosingCta() {
  return (
    <ClosingBand title="Watch a real agent pay a real API." art={<CornerShapes />}>
      <ButtonLink href="/demo" icon="arrowRight">
        Run the live demo
      </ButtonLink>
      <ButtonLink href="/console" variant="secondary">
        Open console
      </ButtonLink>
    </ClosingBand>
  );
}
