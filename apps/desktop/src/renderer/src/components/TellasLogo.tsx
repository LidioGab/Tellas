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
        <div className="absolute inset-0 bg-[#5B7CFA]/20 blur-md rounded-full pointer-events-none" />
      )}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1024 1024"
        role="img"
        aria-label="Tellas Logo"
        className="w-full h-full object-contain relative z-10 select-none pointer-events-none drop-shadow-sm"
      >
        {/* Outer ring */}
        <circle cx="512" cy="512" r="458" fill="#ffffff" stroke="#000000" strokeWidth="18" />
        {/* Inner black disc, leaving a white ring */}
        <circle cx="512" cy="512" r="420" fill="#000000" />

        {/* Motion / streaming lines */}
        <g fill="#ffffff">
          <rect x="205" y="392" width="185" height="22" rx="11" />
          <rect x="235" y="438" width="145" height="22" rx="11" />
          <rect x="285" y="484" width="105" height="22" rx="11" />
        </g>

        {/* Stylized T / media mark */}
        <path
          fill="#ffffff"
          d="
            M 320 330
            Q 304 330 294 343
            L 250 402
            Q 238 418 257 418
            L 520 418
            Q 538 418 525 431
            L 430 520
            L 430 700
            L 545 612
            L 545 505
            L 665 505
            Q 677 505 685 496
            L 762 404
            Q 772 392 761 380
            L 715 337
            Q 708 330 695 330
            Z
          "
        />

        {/* Lower stem segment with diagonal visual break */}
        <path
          fill="#ffffff"
          d="
            M 430 716
            L 545 628
            L 545 780
            Q 545 795 532 804
            L 482 839
            Q 470 847 457 839
            L 430 820
            Z
          "
        />

        {/* Play symbol cutout */}
        <path
          fill="#000000"
          d="M 640 390 L 715 438 Q 726 445 715 452 L 640 500 Q 625 510 625 491 L 625 399 Q 625 380 640 390 Z"
        />
      </svg>
    </div>
  );
};

export default TellasLogo;


