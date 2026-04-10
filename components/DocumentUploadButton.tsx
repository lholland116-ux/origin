"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";

type Props = {
  disabled?: boolean;
  onFilesSelected: (files: File[]) => void;
};

export default function DocumentUploadButton({
  disabled,
  onFilesSelected,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border hover:bg-muted disabled:opacity-50"
        aria-label="Upload document"
        title="Upload document"
      >
        <Plus className="h-5 w-5" />
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFilesSelected(files);
          e.currentTarget.value = "";
        }}
      />
    </>
  );
}