import type { CapaParticipant } from "./capa-participant-client";

export default function CapaParticipantSelector({ participants, value, currentUserId, disabled, onChange }: {
  readonly participants: readonly CapaParticipant[]; readonly value: string;
  readonly currentUserId: string; readonly disabled: boolean; readonly onChange: (userId: string) => void;
}) {
  return <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}
    className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100">
    <option value="">Select an eligible owner</option>
    {participants.map((participant) => <option key={participant.userId} value={participant.userId}>
      {participant.userId === currentUserId ? "You" : participant.displayLabel ?? "Eligible participant"}
    </option>)}
  </select>;
}
