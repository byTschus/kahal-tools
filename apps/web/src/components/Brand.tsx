/** Logo: drei Pegel-Balken auf grünem Grund */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#1f6f5c" />
      <rect x="8" y="13" width="3.2" height="10" rx="1.6" fill="#cfe9df" />
      <rect x="14.4" y="8" width="3.2" height="15" rx="1.6" fill="#fff" />
      <rect x="20.8" y="16" width="3.2" height="7" rx="1.6" fill="#8fd3bd" />
    </svg>
  );
}

export function Brand({ subtitle, href = '/' }: { subtitle?: string; href?: string }) {
  return (
    <a href={href} className="brand">
      <BrandMark />
      <span>
        kahal.tools
        {subtitle && <small>{subtitle}</small>}
      </span>
    </a>
  );
}
