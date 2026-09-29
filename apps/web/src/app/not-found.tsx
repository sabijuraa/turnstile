import { ButtonLink } from "@/components/Button";
import { PageIntro } from "@/components/PageIntro";

export default function NotFound() {
  return (
    <PageIntro
      eyebrow="Error 404"
      title="This page does not exist."
      actions={
        <>
          <ButtonLink href="/">Go to the home page</ButtonLink>
          <ButtonLink href="/docs" variant="secondary">
            Open the docs
          </ButtonLink>
        </>
      }
    >
      The link may be old or mistyped. Go back to the home page or open the docs to find what you
      need.
    </PageIntro>
  );
}
