import React from 'react';

interface TellasLogoProps {
  className?: string;
  size?: number;
  glow?: boolean;
}

export const TellasLogo: React.FC<TellasLogoProps> = ({
  className = 'w-7 h-7',
  glow = true
}) => {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      {glow && (
        <div className="absolute inset-0 bg-[#E82127]/30 blur-md rounded-full pointer-events-none transform scale-110"></div>
      )}
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full relative z-10 drop-shadow-[0_0_8px_rgba(232,33,39,0.6)]"
      >
        {/* Tesla Top Curved Canopy / Arch */}
        <path
          d="M50 20 C36 20 23 23.5 12 30 C13.5 32 16.5 34 19 35 C27.5 29.5 38 27 50 27 C62 27 72.5 29.5 81 35 C83.5 34 86.5 32 88 30 C77 23.5 64 20 50 20 Z"
          fill="#E82127"
        />

        {/* Tesla Main T Armor Spike */}
        <path
          d="M50 33 C41 33 32 35.5 25 40 L29 45.5 C35 42 42 40 50 40 C58 40 65 42 71 45.5 L75 40 C68 35.5 59 33 50 33 Z"
          fill="#FFFFFF"
        />

        {/* Tesla Center Vertical Stem & Tip */}
        <path
          d="M45.5 46.5 L46.5 76 C47.5 78.5 50 82 50 82 C50 82 52.5 78.5 53.5 76 L54.5 46.5 C53 46.8 51.5 47 50 47 C48.5 47 47 46.8 45.5 46.5 Z"
          fill="#E82127"
        />
      </svg>
    </div>
  );
};

export default TellasLogo;
