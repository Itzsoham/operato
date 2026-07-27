import { AssistantClient } from "@/components/assistant/assistant-client";
import { PageHeader } from "@/components/shell/page-header";
import { requirePageMember } from "@/lib/session";

export default async function AssistantPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  // Every page re-checks membership. The layout does too — belt and braces, because
  // this is the guarantee the whole product rests on.
  await requirePageMember(restaurantId);

  return (
    <>
      <PageHeader
        title="Ask AI"
        description="Ask a plain-English question about your business — the assistant writes and runs the SQL."
      />
      <AssistantClient restaurantId={restaurantId} />
    </>
  );
}
