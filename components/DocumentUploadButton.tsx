"use client";

type Props = {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
};

export default function DocumentUploadButton({
  onFilesSelected,
  disabled,
}: Props) {
  return (
    <label className="cursor-pointer">
      <input
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

      <div className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl border border-neutral-700 bg-neutral-900 text-xl text-white hover:border-neutral-500">
        +
      </div>
    </label>
  );
}