"use client";

import { ImagePlus, Paperclip, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import {
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  SUPPORTED_ATTACHMENT_MIME_TYPES,
} from "@/features/attachments/constants";

const supportedTypes = new Set<string>(SUPPORTED_ATTACHMENT_MIME_TYPES);

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 1024 * 1024 ? 1 : 2)} MB`;
}

function candidateFiles(items: DataTransferItemList | undefined): File[] {
  if (!items) return [];
  return Array.from(items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export function ScreenshotInput({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const previews = useMemo(
    () =>
      value.map((file) => ({
        file,
        url:
          typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(file)
            : null,
      })),
    [value],
  );

  useEffect(
    () => () => {
      for (const preview of previews) {
        if (preview.url) URL.revokeObjectURL(preview.url);
      }
    },
    [previews],
  );

  function addFiles(files: readonly File[]) {
    if (disabled || files.length === 0) return;
    if (value.length + files.length > MAX_ATTACHMENT_COUNT) {
      setError(`每条需求最多上传 ${MAX_ATTACHMENT_COUNT} 张截图`);
      return;
    }
    const unsupported = files.find((file) => !supportedTypes.has(file.type));
    if (unsupported) {
      setError("仅支持 PNG、JPEG 或 WebP 图片");
      return;
    }
    const tooLarge = files.find((file) => file.size > MAX_ATTACHMENT_SIZE_BYTES);
    if (tooLarge) {
      setError(`单张截图不能超过 ${formatMegabytes(MAX_ATTACHMENT_SIZE_BYTES)}`);
      return;
    }
    const totalBytes = [...value, ...files].reduce(
      (total, file) => total + file.size,
      0,
    );
    if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
      setError(`全部截图合计不能超过 ${formatMegabytes(MAX_ATTACHMENTS_TOTAL_BYTES)}`);
      return;
    }
    setError(null);
    onChange([...value, ...files]);
  }

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('[data-screenshot-paste-target="true"]')) return;
      const files = candidateFiles(event.clipboardData?.items);
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files);
    }

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  });

  return (
    <div className="screenshot-input-wrap">
      <div
        className="screenshot-input"
        data-testid="screenshot-input"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          addFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <ImagePlus aria-hidden="true" size={22} />
        <div>
          <p className="screenshot-input__title">粘贴、拖放或选择截图</p>
          <p className="screenshot-input__hint">
            PNG、JPEG、WebP；每张 10 MB，最多 8 张
          </p>
        </div>
        <label className="button button--secondary button--small screenshot-input__select">
          <Paperclip aria-hidden="true" size={16} />
          选择截图
          <input
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={disabled}
            aria-label="选择截图"
            onChange={(event) => {
              addFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {previews.length > 0 ? (
        <ul className="screenshot-preview-list" aria-label="待上传截图">
          {previews.map(({ file, url }, index) => (
            <li className="screenshot-preview" key={`${file.name}-${file.size}-${index}`}>
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="screenshot-preview__image" />
              ) : (
                <div className="screenshot-preview__placeholder" aria-hidden="true">
                  <ImagePlus size={18} />
                </div>
              )}
              <div className="screenshot-preview__meta">
                <span className="screenshot-preview__name">{file.name}</span>
                <span>{formatMegabytes(file.size)}</span>
              </div>
              <IconButton
                label={`移除 ${file.name}`}
                icon={<Trash2 size={16} />}
                disabled={disabled}
                onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
