import React from 'react';

interface TellasLogoProps {
  className?: string;
  glow?: boolean;
}

export const TellasLogo: React.FC<TellasLogoProps> = ({
  className = 'w-6 h-6',
  glow = false
}) => {
  return (
    <div className={`relative flex items-center justify-center shrink-0 ${className}`}>
      {glow && (
        <div className="absolute inset-0 bg-white/10 blur-xl rounded-full pointer-events-none" />
      )}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
        role="img"
        aria-label="Tellas Logo"
        className="w-full h-full object-contain relative z-10 select-none pointer-events-none drop-shadow-md"
      >
        <defs>
          <radialGradient id="tellas-halo" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <filter id="tellas-blurBig" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
          <filter id="tellas-blurMid" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <g id="tellas-t-mark" strokeLinejoin="round">
            <path
              d="M100 122 H368 V184 H265 V358 H203 V184 H100 Z"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="7"
              opacity="0.5"
            />
            <path
              d="M122 144 H390 V206 H287 V380 H225 V206 H122 Z"
              fill="#FFFFFF"
              stroke="#FFFFFF"
              strokeWidth="24"
            />
          </g>
        </defs>

        {/* Rounded dark background disc */}
        <rect width="512" height="512" rx="112" fill="#0A0A0A" />
        <rect width="512" height="512" rx="112" fill="url(#tellas-halo)" />

        {/* Dynamic skewed lettermark */}
        <g transform="translate(55 5) skewX(-10)">
          <use href="#tellas-t-mark" filter="url(#tellas-blurBig)" opacity="0.3" />
          <use href="#tellas-t-mark" filter="url(#tellas-blurMid)" opacity="0.25" />
          <use href="#tellas-t-mark" />
        </g>
      </svg>
    </div>
  );
};

export default TellasLogo;
