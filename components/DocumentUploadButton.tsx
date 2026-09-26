"use client";

import type { Ref } from "react";

type Props = {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  hideTrigger?: boolean;
};

export default function DocumentUploadButton({
  onFilesSelected,
  disabled,
  inputRef,
  hideTrigger = false,
}: Props) {
  return (
    <label className={hideTrigger ? "hidden" : "cursor-pointer"}>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const files = e.target.files;
          if (!files) return;

          const fileArray = Array.from(files);

          console.log("UPLOAD BUTTON FILES:", fileArray);

          onFilesSelected(fileArray);

          // reset input so same file can be selected again
          e.target.value = "";
        }}
      />

      {!hideTrigger && (
        <div className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl border border-neutral-700 bg-neutral-900 text-xl text-white hover:border-neutral-500">
          +
        </div>
      )}
    </label>
  );
}
