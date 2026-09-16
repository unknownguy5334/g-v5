import React from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, RotateCcw, X, XCircle } from 'lucide-react';

export type WorkflowStatusKind = 'loading' | 'success' | 'partial' | 'empty' | 'warning' | 'error' | 'cancelled' | 'info';

interface WorkflowStatusProps {
  kind: WorkflowStatusKind;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
  compact?: boolean;
  autoFocus?: boolean;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onClose?: () => void;
}

const ICONS = {
  loading: Loader2,
  success: CheckCircle2,
  partial: Info,
  empty: Info,
  warning: AlertCircle,
  error: AlertCircle,
  cancelled: XCircle,
  info: Info,
} as const;

export const WorkflowStatus: React.FC<WorkflowStatusProps> = ({
  kind,
  title,
  description,
  actionLabel,
  onAction,
  actionDisabled,
  secondaryActionLabel,
  onSecondaryAction,
  className = '',
  compact = false,
  autoFocus = false,
  containerRef,
  onClose,
}) => {
  const Icon = ICONS[kind];
  const isErrorLike = kind === 'error' || kind === 'cancelled';
  return (
    <div
      role={isErrorLike ? 'alert' : 'status'}
      aria-live={isErrorLike ? 'assertive' : 'polite'}
      ref={containerRef}
      tabIndex={autoFocus ? -1 : undefined}
      autoFocus={autoFocus}
      className={`workflow-status workflow-status-${kind} ${compact ? 'workflow-status-compact' : ''} ${className}`.trim()}
    >
      <div className="workflow-status-icon" aria-hidden="true">
        <Icon className={`w-4 h-4 ${kind === 'loading' ? 'animate-spin' : ''}`} />
      </div>
      <div className="workflow-status-copy">
        <div className="flex items-start justify-between gap-3">
          <strong>{title}</strong>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] p-1 -mr-1.5 -mt-1 text-text-muted hover:text-ink transition-colors rounded-lg hover:bg-black/5 inline-flex items-center justify-center cursor-pointer"
              aria-label="Close message"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {description && <span>{description}</span>}
        {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
          <div className="workflow-status-actions">
            {actionLabel && onAction && (
              <button
                type="button"
                className="workflow-status-action"
                onClick={onAction}
                disabled={actionDisabled}
              >
                {kind === 'error' && <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
                {actionLabel}
              </button>
            )}
            {secondaryActionLabel && onSecondaryAction && (
              <button
                type="button"
                className="workflow-status-secondary-action"
                onClick={onSecondaryAction}
              >
                {secondaryActionLabel}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};
