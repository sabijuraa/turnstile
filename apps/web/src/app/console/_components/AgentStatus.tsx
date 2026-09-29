import { StatusPill, type StatusTone } from "@/components/StatusPill";
import type { AgentStatus } from "@/lib/console/types";

const labels: Record<AgentStatus, { tone: StatusTone; text: string }> = {
  active: { tone: "positive", text: "Active" },
  near_cap: { tone: "caution", text: "Near daily cap" },
  at_cap: { tone: "critical", text: "Daily cap reached" },
  unfunded: { tone: "caution", text: "Needs funds" },
  no_allow_list: { tone: "caution", text: "Empty allow-list" },
  no_active_key: { tone: "critical", text: "No active session key" },
};

export function agentStatusText(status: AgentStatus): string {
  return labels[status].text;
}

export function AgentStatusPill({ status }: { status: AgentStatus }) {
  const { tone, text } = labels[status];
  return <StatusPill tone={tone}>{text}</StatusPill>;
}
