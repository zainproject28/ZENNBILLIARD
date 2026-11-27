import React from 'react';
import { FlashlightTextReveal } from '@/components/ui/flashlight-text-reveal.tsx';

interface ArcadeBackdropProps {
  variant?: 'home' | 'auth' | 'arena';
}

export const ArcadeBackdrop: React.FC<ArcadeBackdropProps> = ({ variant = 'home' }) => {
  if (variant === 'arena') {
    return (
      <div className='fixed inset-0 pointer-events-none overflow-hidden bg-[#06070a]' aria-hidden='true'>
        <div
          className='absolute inset-0'
          style={{
            background:
              'radial-gradient(circle at 50% 42%, #171922 0%, #0d0f14 52%, #060709 100%)',
          }}
        />
        <div className='absolute inset-0 mafia-lattice opacity-35' />
        <div
          className='absolute inset-0 opacity-45'
          style={{
            background:
              'radial-gradient(circle at 50% 10%, rgba(245, 158, 11, 0.09) 0%, transparent 48%), radial-gradient(circle at 18% 82%, rgba(185, 28, 28, 0.08) 0%, transparent 45%)',
          }}
        />
      </div>
    );
  }

  return (
    <div className='fixed inset-0 pointer-events-none overflow-hidden select-none bg-[#06070a]' aria-hidden='true'>
      {/* Interactive Flashlight WebGL Shader Wall (Cursor + Autonomous Lounge Spotlight) */}
      <FlashlightTextReveal
        text={'ZENN\nBILLIARD\nCLUB'}
        textColor='#f3e3c2'
        ghost={variant === 'auth' ? 0.045 : 0.03}
        fontFamily='"Outfit", "Plus Jakarta Sans", sans-serif'
        fontSize='clamp(3.6rem, 12vw, 10.5rem)'
        wander
        radius={variant === 'auth' ? 0.4 : 0.36}
        strength={0.95}
        colors={['#06070a', '#171310', '#2b1e15', '#1b0f13']}
        speed={0.72}
        scale={2.4}
        intensity={0.58}
        warp={0.18}
        detail={2.1}
        contrast={0.96}
        brightness={-0.12}
        saturation={0.95}
        vignette={0.42}
        blur={0.014}
        grain={0.14}
        drift={0.04}
        height='100%'
        className='absolute inset-0 h-full w-full'
      />

      {/* Rich Ambient Lounge Spotlight Orbs behind Translucent iOS Glass Cards */}
      <div
        className='absolute inset-0'
        style={{
          background:
            variant === 'home'
              ? 'radial-gradient(620px 360px at 22% 38%, rgba(217, 119, 6, 0.22) 0%, transparent 65%), radial-gradient(560px 340px at 78% 42%, rgba(56, 189, 248, 0.14) 0%, transparent 64%), radial-gradient(540px 320px at 50% 78%, rgba(220, 38, 38, 0.16) 0%, transparent 66%)'
              : 'radial-gradient(600px 360px at 50% 42%, rgba(232, 199, 130, 0.15) 0%, transparent 66%)',
        }}
      />

      {/* Architectural Smoked Gold Grid Texture Overlay */}
      <div
        className='absolute inset-0 mafia-lattice'
        style={{
          maskImage: 'radial-gradient(circle at 50% 42%, rgba(0,0,0,0.85) 20%, rgba(0,0,0,0.22) 85%)',
          WebkitMaskImage: 'radial-gradient(circle at 50% 42%, rgba(0,0,0,0.85) 20%, rgba(0,0,0,0.22) 85%)',
        }}
      />

      {/* Dark Mafia Velvet Depth Scrim keeping frosted cards crisp & readable */}
      <div
        className='absolute inset-0'
        style={{
          background:
            variant === 'auth'
              ? 'radial-gradient(circle at 50% 46%, rgba(8, 9, 13, 0.22) 0%, rgba(6, 7, 10, 0.68) 78%, rgba(5, 6, 8, 0.88) 100%)'
              : 'radial-gradient(circle at 50% 44%, rgba(8, 9, 13, 0.16) 0%, rgba(6, 7, 10, 0.56) 78%, rgba(5, 6, 8, 0.84) 100%)',
        }}
      />
    </div>
  );
};
