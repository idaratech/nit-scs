
import React, { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

interface DetailModalAction {
  label: string;
  onClick: () => void;
  variant: 'primary' | 'danger' | 'secondary';
}

interface DetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: DetailModalAction[];
}

const variantClasses: Record<DetailModalAction['variant'], string> = {
  primary:
    'bg-gradient-to-r from-nesma-primary to-nesma-primary/80 text-white border border-nesma-primary/50 hover:shadow-[0_0_20px_rgba(46,49,146,0.4)] hover:from-nesma-primary/90 hover:to-nesma-primary/70',
  danger:
    'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 hover:shadow-[0_0_15px_rgba(239,68,68,0.2)]',
  secondary:
    'bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20',
};

export const DetailModal: React.FC<DetailModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  actions,
}) => {
  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Prevent body scroll
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[fadeIn_200ms_ease-out]"
        onClick={onClose}
      />

      {/* Modal container */}
      <div className="relative z-10 w-full max-w-3xl max-h-[90vh] mx-4 flex flex-col animate-[scaleIn_200ms_ease-out]">
        <div className="bg-[#0a1929]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/40 flex flex-col max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-start justify-between px-6 py-5 border-b border-white/10 flex-shrink-0">
            <div className="flex-1 min-w-0 pr-4">
              <h2 className="text-xl font-bold text-white truncate">{title}</h2>
              {subtitle && (
                <p className="text-sm text-gray-400 mt-1 truncate">{subtitle}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all active:scale-95 transform flex-shrink-0"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
            {children}
          </div>

          {/* Footer with actions */}
          {actions && actions.length > 0 && (
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 flex-shrink-0 bg-black/20">
              {actions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={action.onClick}
                  className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all active:scale-95 transform ${variantClasses[action.variant]}`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Keyframe animations injected via style tag */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
};
