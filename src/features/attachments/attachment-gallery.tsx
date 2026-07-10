import { ExternalLink, Image as ImageIcon, X } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import type { AttachmentDto } from "@/features/attachments/service";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentGallery({
  attachments,
  onRemove,
}: {
  attachments: readonly AttachmentDto[];
  onRemove?: (attachmentId: number) => void;
}) {
  if (attachments.length === 0) {
    return <p className="section-empty">暂无截图</p>;
  }

  return (
    <ul className="attachment-gallery" aria-label="需求截图">
      {attachments.map((attachment) => (
        <li className="attachment-item" key={attachment.id}>
          <a
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="attachment-item__preview"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attachment.url} alt={attachment.originalName} />
          </a>
          <div className="attachment-item__meta">
            <ImageIcon aria-hidden="true" size={15} />
            <span title={attachment.originalName}>{attachment.originalName}</span>
            <small>{formatSize(attachment.sizeBytes)}</small>
          </div>
          <div className="attachment-item__actions">
            <a
              className="icon-button"
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`查看 ${attachment.originalName}`}
              title={`查看 ${attachment.originalName}`}
            >
              <ExternalLink aria-hidden="true" size={16} />
            </a>
            {onRemove ? (
              <IconButton
                label={`移除 ${attachment.originalName}`}
                icon={<X size={16} />}
                onClick={() => onRemove(attachment.id)}
              />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
