import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** Nur-Lese-Feld mit Kopieren-Button (z.B. für Redirect-URLs) */
export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <input type="text" readOnly value={value} onFocus={(e) => e.target.select()} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }} />
      <button
        type="button"
        className="btn icon-only"
        title="Kopieren"
        aria-label="Kopieren"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}
