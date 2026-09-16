import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalAccessibility } from '../hooks/useModalAccessibility';

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  maxWidthClass?: string;
  children: React.ReactNode;
  autoHeight?: boolean;
}

export const ModalShell: React.FC<ModalShellProps> = ({
  isOpen,
  onClose,
  title,
  description,
  maxWidthClass = 'max-w-md',
  children,
  autoHeight = false,
}) => {
  const modalRef = useModalAccessibility<HTMLDivElement>({ isOpen, onClose, manageHistory: false });
  if (!isOpen) return null;
  const overlayRoot = typeof document !== 'undefined' ? (document.getElementById('gadwal-overlay-root') || document.body) : null;
  const content = (
    <div
      className="gd-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-hidden motion-safe:animate-in motion-safe:fade-in duration-150 bg-ink/50"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className={`gd-modal-shell w-full ${maxWidthClass} flex flex-col text-ink relative ${autoHeight ? 'max-h-[92dvh] h-auto' : 'h-[min(90dvh,640px)] max-h-[90dvh]'} overflow-hidden rounded-2xl shadow-xl bg-white`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="z-20 shrink-0 border-b border-line bg-paper px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div>
            <h2 id="modal-title" className="text-lg font-bold text-ink tracking-tight">
              {title}
            </h2>
            {description && <p className="text-xs text-text-secondary mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-mist text-text-secondary hover:text-ink transition-colors cursor-pointer min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="gd-modal-body flex-1 min-h-0 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
  return overlayRoot ? createPortal(content, overlayRoot) : content;
};
