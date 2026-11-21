import React from 'react';

interface ShineCabLogoProps {
  variant?: 'light' | 'dark' | 'transparent';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showWordmark?: boolean;
  animated?: boolean;
}

export const ShineCabLogo: React.FC<ShineCabLogoProps> = ({
  variant = 'light',
  size = 'md',
  showWordmark = true,
  animated = false,
}) => {
  const iconDims =
    size === 'xl'
      ? 'w-20 h-20'
      : size === 'lg'
        ? 'w-12 h-12'
        : size === 'sm'
          ? 'w-8 h-8'
          : 'w-10 h-10';

  const textSize =
    size === 'xl'
      ? 'text-3xl tracking-tight'
      : size === 'lg'
        ? 'text-2xl tracking-tight'
        : size === 'sm'
          ? 'text-base tracking-tight'
          : 'text-lg tracking-tight';

  const bgFill =
    variant === 'transparent' ? 'transparent' : variant === 'dark' ? '#1E1E1E' : '#111111';
  const secondaryRibbon = variant === 'transparent' ? '#111111' : '#FFFFFF';
  const wordmarkColor = variant === 'dark' ? 'text-white' : 'text-[#111111]';

  return (
    <div className="inline-flex items-center gap-2.5 shrink-0 select-none">
      <svg
        className={`${iconDims} shrink-0 ${animated ? 'transition-transform duration-700' : ''}`}
        viewBox="0 0 128 128"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {variant !== 'transparent' && (
          <rect width="128" height="128" rx="30" fill={bgFill} />
        )}
        {/* Primary Dynamic Road Chevron */}
        <path
          d="M32 94L54 34H74L52 94H32Z"
          fill="#FFC928"
          className={animated ? 'animate-[pulse_2.4s_ease-in-out_infinite]' : ''}
        />
        {/* Parallel Speed Lane */}
        <path
          d="M58 94L80 34H96L74 94H58Z"
          fill={variant === 'transparent' ? '#111111' : secondaryRibbon}
        />
        {/* Precision Road Cutout */}
        <path
          d="M44 64H84"
          stroke={variant === 'transparent' ? '#F7F8FA' : bgFill}
          strokeWidth="5"
          strokeLinecap="round"
        />
        {/* Navigation Beacon */}
        <circle cx="92" cy="38" r="6" fill="#FFC928" />
      </svg>

      {showWordmark && (
        <span
          className={`font-display font-extrabold whitespace-nowrap ${textSize} ${wordmarkColor}`}
        >
          SHINE <span className="text-[#FFC928] bg-[#111111] px-1.5 py-0.5 rounded-md ml-0.5">CAB</span>
        </span>
      )}
    </div>
  );
};
