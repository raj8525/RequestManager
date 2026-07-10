"use client";

import { ChevronLeft, ChevronRight, Expand, Image as ImageIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import type { AttachmentDto } from "@/features/attachments/service";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentGallery({
  attachments,
  onRemove,
  disabled = false,
}: {
  attachments: readonly AttachmentDto[];
  onRemove?: (attachmentId: number) => void;
  disabled?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const activeAttachment = activeIndex === null ? null : attachments[activeIndex];

  function openPreview(index: number) {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActiveIndex(index);
  }

  function closePreview() {
    setActiveIndex(null);
  }

  useEffect(() => {
    if (activeIndex === null) {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
      return;
    }

    closeButtonRef.current?.focus();
  }, [activeIndex]);

  useEffect(() => {
    if (activeIndex === null) return;
    const currentIndex = activeIndex;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePreview();
      }

      if (event.key === "ArrowLeft" && currentIndex > 0) {
        event.preventDefault();
        setActiveIndex(currentIndex - 1);
      }

      if (event.key === "ArrowRight" && currentIndex < attachments.length - 1) {
        event.preventDefault();
        setActiveIndex(currentIndex + 1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, attachments.length]);

  if (attachments.length === 0) {
    return <p className="section-empty">暂无截图</p>;
  }

  return (
    <>
      <ul className="attachment-gallery" aria-label="需求截图">
        {attachments.map((attachment, index) => (
          <li className="attachment-item" key={attachment.id}>
            <button
              type="button"
              className="attachment-item__preview"
              style={{ aspectRatio: "16 / 9" }}
              onClick={() => openPreview(index)}
              aria-label={`放大查看 ${attachment.originalName}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.url}
                alt={attachment.originalName}
                style={{ objectFit: "contain" }}
              />
            </button>
            <div className="attachment-item__meta">
              <ImageIcon aria-hidden="true" size={15} />
              <span title={attachment.originalName}>{attachment.originalName}</span>
              <small>{formatSize(attachment.sizeBytes)}</small>
            </div>
            <div className="attachment-item__actions">
              <IconButton
                label={`预览 ${attachment.originalName}`}
                icon={<Expand size={16} />}
                onClick={() => openPreview(index)}
              />
              {onRemove ? (
                <IconButton
                  label={`移除 ${attachment.originalName}`}
                  icon={<X size={16} />}
                  disabled={disabled}
                  onClick={() => onRemove(attachment.id)}
                />
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {activeAttachment && activeIndex !== null ? (
        <div
          className="attachment-lightbox"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
        >
          <div className="attachment-lightbox__dialog" role="dialog" aria-modal="true" aria-label="截图预览">
            <button
              ref={closeButtonRef}
              type="button"
              className="icon-button attachment-lightbox__close"
              onClick={closePreview}
              aria-label="关闭图片预览"
              title="关闭图片预览"
            >
              <X aria-hidden="true" size={20} />
            </button>
            <button
              type="button"
              className="icon-button attachment-lightbox__previous"
              onClick={() => setActiveIndex(activeIndex - 1)}
              disabled={activeIndex === 0}
              aria-label="查看上一张截图"
              title="查看上一张截图"
            >
              <ChevronLeft aria-hidden="true" size={24} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="attachment-lightbox__image"
              src={activeAttachment.url}
              alt={activeAttachment.originalName}
            />
            <button
              type="button"
              className="icon-button attachment-lightbox__next"
              onClick={() => setActiveIndex(activeIndex + 1)}
              disabled={activeIndex === attachments.length - 1}
              aria-label="查看下一张截图"
              title="查看下一张截图"
            >
              <ChevronRight aria-hidden="true" size={24} />
            </button>
            <p className="attachment-lightbox__caption">
              <span>{activeAttachment.originalName}</span>
              {attachments.length > 1 ? <small>{activeIndex + 1} / {attachments.length}</small> : null}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
