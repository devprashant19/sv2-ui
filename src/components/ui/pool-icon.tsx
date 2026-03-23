import { Server } from 'lucide-react';

interface PoolIconProps {
  logoUrl?: string | null;
  logoOnDark?: boolean;
  name?: string;
}

export function PoolIcon({ logoUrl, logoOnDark, name }: PoolIconProps) {
  return (
    <div
      className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: logoOnDark ? '#27272a' : 'hsl(var(--muted) / 0.5)' }}
      aria-hidden="true"
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={name ?? ''}
          className="w-7 h-7 object-contain"
          onError={e => {
            e.currentTarget.style.display = 'none';
            (e.currentTarget.nextElementSibling as HTMLElement)?.classList.remove('hidden');
          }}
        />
      ) : null}
      <Server className={`w-5 h-5 text-muted-foreground ${logoUrl ? 'hidden' : ''}`} />
    </div>
  );
}
