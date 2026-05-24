'use client';

interface Customization {
  customization_name: string;
  options: Array<{ option_name: string; price_adjustment: number }>;
}

interface KdsOrderDetailLineProps {
  customNote?: string | null;
  customizations?: Customization[];
  className?: string;
}

/** Customizations + note for KDS order row (column 1, row 2). */
export default function KdsOrderDetailLine({
  customNote,
  customizations,
  className = '',
}: KdsOrderDetailLineProps) {
  const hasCustomizations = customizations && customizations.length > 0;
  const note = customNote?.trim() || null;
  if (!hasCustomizations && !note) return null;

  return (
    <div className={`text-sm text-black break-words flex flex-wrap gap-x-1 font-medium leading-snug ${className}`}>
      {hasCustomizations && (
        <span className="text-blue-900">
          {customizations!.map((customization, idx) => (
            <span key={idx}>
              {customization.options.map((option, optIdx) => (
                <span key={optIdx}>
                  +{option.option_name}
                  {option.price_adjustment !== 0 && ` (+${option.price_adjustment})`}
                  {optIdx < customization.options.length - 1 && ', '}
                </span>
              ))}
              {idx < customizations!.length - 1 && ', '}
            </span>
          ))}
        </span>
      )}
      {note && (
        <span className="text-purple-900">
          {hasCustomizations && ' | '}
          note: {note}
        </span>
      )}
    </div>
  );
}
