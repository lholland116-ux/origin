type DocumentChipProps = {
  name: string;
  status: "uploading" | "ready" | "failed";
  onRemove?: () => void;
};

export default function DocumentChip({
  name,
  status,
  onRemove,
}: DocumentChipProps) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
      <span className="truncate max-w-[180px]">{name}</span>
      <span className="text-xs opacity-70">
        {status === "uploading" && "Uploading"}
        {status === "ready" && "Ready"}
        {status === "failed" && "Failed"}
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="text-xs opacity-70 hover:opacity-100"
          aria-label={`Remove ${name}`}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}