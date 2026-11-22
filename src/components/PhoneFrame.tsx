import React from 'react';

interface PhoneFrameProps {
  children: React.ReactNode;
  darkScreen?: boolean;
}

export const PhoneFrame: React.FC<PhoneFrameProps> = ({ children, darkScreen = false }) => {
  return (
    <div
      className={`min-h-dvh w-full md:bg-[#111216] md:flex md:items-center md:justify-center md:p-4 ${
        darkScreen ? 'bg-[#111111]' : 'bg-white'
      }`}
    >
      <div
        className={`w-full h-dvh pt-[max(env(safe-area-inset-top),32px)] pb-[max(env(safe-area-inset-bottom),12px)] md:pt-0 md:pb-0 md:w-[412px] md:max-w-full md:h-[min(860px,calc(100dvh-2rem))] md:rounded-[38px] md:border-[7px] md:border-[#1F2026] md:shadow-[0_24px_70px_rgba(0,0,0,0.48)] md:[transform:translateZ(0)] overflow-hidden relative flex flex-col ${
          darkScreen ? 'bg-[#111111] text-white' : 'bg-[#F7F8FA] text-[#111111]'
        }`}
      >
        {children}
      </div>
    </div>
  );
};
