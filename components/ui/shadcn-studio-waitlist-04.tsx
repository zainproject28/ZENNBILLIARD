'use client';

import * as React from 'react';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { Input as InputPrimitive } from '@base-ui/react/input';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowRightIcon, MailIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ArcadeBackdrop } from '../../src/components/ArcadeBackdrop.tsx';
import { t, type Language } from '../../src/services/i18n.ts';

export interface WaitlistAvatar {
  src: string;
  name: string;
  fallback: string;
}

export interface Waitlist04Props {
  brandName?: string;
  title?: string;
  description?: string;
  emailPlaceholder?: string;
  submitLabel?: string;
  note?: string;
  language?: Language;
  onLanguageChange?: (lang: Language) => void;
  onSubmit?: (email: string) => void;
  children?: React.ReactNode;
  className?: string;
}

export function ZennCrestLogo({ className }: { className?: string }) {
  const uid = React.useId().replace(/:/g, '');
  const bgId = `zennCrestBg_${uid}`;
  const goldId = `zennCrestGold_${uid}`;

  return (
    <svg
      width='34'
      height='34'
      viewBox='0 0 64 64'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
    >
      <defs>
        <linearGradient id={bgId} x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stopColor='#27272a' />
          <stop offset='100%' stopColor='#09090b' />
        </linearGradient>
        <linearGradient id={goldId} x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stopColor='#f4f4f5' />
          <stop offset='55%' stopColor='#f59e0b' />
          <stop offset='100%' stopColor='#71717a' />
        </linearGradient>
      </defs>
      <circle cx='32' cy='32' r='30' fill={`url(#${bgId})`} stroke={`url(#${goldId})`} strokeWidth='3.2' />
      <path d='M20 21 H44 L23 43 H44' stroke='#f4f4f5' strokeWidth='5.5' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow]',
  {
    variants: {
      variant: {
        default: 'bg-zinc-200 text-zinc-950',
        secondary: 'bg-[#181b22] text-zinc-200 border-white/10',
        destructive: 'bg-red-700 text-white',
        outline: 'border-white/15 text-zinc-200',
        ghost: 'text-zinc-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot='badge'
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-amber-400 focus-visible:ring-[3px] focus-visible:ring-amber-400/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-[#232632] border border-amber-400/70 text-zinc-50 hover:bg-[#2c303f] hover:border-amber-300',
        destructive: 'bg-red-700 text-white hover:bg-red-600',
        outline:
          'border border-white/12 bg-[#16181f] text-zinc-100 shadow-xs hover:bg-[#1e212b] hover:border-white/25',
        secondary: 'bg-[#181b22] text-zinc-200 hover:bg-[#22252f]',
        ghost: 'text-zinc-200 hover:bg-white/10',
        link: 'text-amber-400 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-lg px-3 text-xs',
        lg: 'h-10 rounded-xl px-5',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot='button'
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot='input'
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-white/12 bg-transparent px-3 py-1 text-sm text-zinc-100 shadow-xs transition-[color,box-shadow] outline-none selection:bg-amber-500/30 selection:text-amber-100 placeholder:text-zinc-500 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-amber-400 focus-visible:ring-[3px] focus-visible:ring-amber-400/25',
        className,
      )}
      {...props}
    />
  );
}

export function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='input-group'
      role='group'
      className={cn(
        'group/input-group relative flex h-9 w-full min-w-0 items-center rounded-xl neu-inset transition-[color,box-shadow] outline-none',
        'has-[[data-slot=input-group-control]:focus-visible]:border-amber-400/80 has-[[data-slot=input-group-control]:focus-visible]:ring-[2px] has-[[data-slot=input-group-control]:focus-visible]:ring-amber-400/20',
        className,
      )}
      {...props}
    />
  );
}

export function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: React.ComponentProps<'div'> & { align?: 'inline-start' | 'inline-end' }) {
  return (
    <div
      role='group'
      data-slot='input-group-addon'
      data-align={align}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.currentTarget.parentElement?.querySelector('input')?.focus();
      }}
      className={cn(
        'flex h-auto cursor-text items-center justify-center gap-2 py-1 text-sm font-medium text-zinc-400 select-none [&>svg:not([class*="size-"])]:size-4',
        align === 'inline-start' ? 'order-first pl-3' : 'order-last pr-3',
        className,
      )}
      {...props}
    />
  );
}

export function InputGroupInput({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <Input
      data-slot='input-group-control'
      className={cn(
        'flex-1 h-full rounded-none border-0 bg-transparent px-2.5 text-zinc-100 placeholder:text-zinc-500 shadow-none ring-0 focus-visible:ring-0',
        className,
      )}
      {...props}
    />
  );
}

export function Waitlist04({
  brandName = 'ZENN BILLIARD',
  title = 'ZENN BILLIARD',
  description = 'Play 8 Ball and 9 Ball online with friends or practice against smart AI.',
  emailPlaceholder = 'yourmail@gmail.com',
  submitLabel = 'Continue',
  note,
  language = 'en',
  onLanguageChange,
  onSubmit,
  children,
  className,
}: Waitlist04Props) {
  const [email, setEmail] = React.useState('');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit?.(email);
  };

  return (
    <div
      className={cn(
        'waitlist-studio-theme relative flex h-[100dvh] w-full flex-col justify-between overflow-hidden bg-[#06070a] text-zinc-100',
        className,
      )}
    >
      <ArcadeBackdrop variant='auth' />

      {/* Top Band: Dark Mafia 3D Neumorphic Header */}
      <header className='relative z-10 shrink-0 border-b border-amber-400/15 bg-[#0e1015]/60 backdrop-blur-lg shadow-[0_8px_24px_rgba(0,0,0,0.5)]'>
        <div className='mx-auto flex max-w-6xl items-center justify-between px-3 sm:px-6 py-2'>
          <div className='flex items-center gap-2.5'>
            <ZennCrestLogo className='w-7 h-7 sm:w-8 sm:h-8 drop-shadow-[0_2px_8px_rgba(245,158,11,0.3)]' />
            <span className='font-display text-base sm:text-lg font-black tracking-wider text-zinc-100'>
              {brandName}
            </span>
          </div>

          {onLanguageChange && (
            <div className='inline-flex items-center rounded-xl neu-inset p-0.5 gap-0.5'>
              {(['en', 'id'] as const).map((code) => (
                <button
                  key={code}
                  type='button'
                  onClick={() => onLanguageChange(code)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase transition-colors cursor-pointer border',
                    language === code
                      ? 'bg-[#222430] border-amber-400/75 text-amber-300 shadow-xs'
                      : 'border-transparent text-zinc-400 hover:text-zinc-100',
                  )}
                >
                  {code === 'en' ? 'EN' : 'ID'}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Main Band: Single-Viewport Centered Frosted Glass Card */}
      <main className='relative z-10 flex flex-1 min-h-0 flex-col items-center justify-center overflow-hidden px-3 py-1.5 sm:px-6 sm:py-2.5'>
        <div className='liquid-metal-border auth-glass-panel relative z-10 mx-auto flex w-full max-w-md flex-col items-center rounded-2xl sm:rounded-3xl px-4 py-3 sm:px-6 sm:py-4.5 text-center'>
          <h1 className='font-display text-lg sm:text-2xl font-black tracking-tight text-zinc-50 leading-tight'>
            {title}
          </h1>

          <p className='mt-0.5 mb-2.5 max-w-md text-[11px] sm:text-xs leading-snug text-zinc-400 hidden sm:block'>
            {description}
          </p>
          <div className='h-1.5 sm:hidden' />

          {children ? (
            <div className='w-full'>{children}</div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className='flex w-full items-center gap-2 max-sm:flex-col max-sm:items-stretch'
            >
              <InputGroup className='flex-1'>
                <InputGroupAddon>
                  <MailIcon className='size-4' />
                </InputGroupAddon>
                <InputGroupInput
                  type='email'
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={emailPlaceholder}
                  required
                />
              </InputGroup>
              <Button type='submit' size='lg' className='h-9 gap-2 text-sm font-semibold'>
                <span>{submitLabel}</span>
                <ArrowRightIcon className='size-4' />
              </Button>
            </form>
          )}

          {note && <p className='mt-2 text-[11px] font-medium text-zinc-500 hidden sm:block'>{note}</p>}
        </div>
      </main>

      {/* Bottom Band: Dark Mafia Developer Links + Footer Watermark */}
      <footer className='relative z-10 shrink-0 border-t border-amber-400/15 bg-[#0e1015]/60 backdrop-blur-lg'>
        <div className='mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 sm:px-6 py-2'>
          <span className='text-[11px] font-semibold text-zinc-400'>
            {t(language, 'footerWatermark')}
          </span>

          <div className='flex items-center gap-2'>
            <a
              href='https://github.com/daffazainproject'
              target='_blank'
              rel='noopener noreferrer'
              aria-label='Developer GitHub'
              data-testid='dev-link-github'
              className='inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg neu-surface text-zinc-200 text-[11px] font-semibold'
            >
              <svg width='14' height='14' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
                <path d='M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.07.78 2.15v3.19c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z' />
              </svg>
              <span className='hidden sm:inline'>GitHub</span>
            </a>

            <a
              href='https://www.instagram.com/daffazain_28/?__pwa=1'
              target='_blank'
              rel='noopener noreferrer'
              aria-label='Developer Instagram'
              data-testid='dev-link-instagram'
              className='inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg neu-surface border-amber-400/25 text-amber-300 text-[11px] font-semibold'
            >
              <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                <rect width='20' height='20' x='2' y='2' rx='5' ry='5' />
                <path d='M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z' />
                <line x1='17.5' x2='17.51' y1='6.5' y2='6.5' />
              </svg>
              <span className='hidden sm:inline'>Instagram</span>
            </a>

            <a
              href='https://wa.me/628131313206'
              target='_blank'
              rel='noopener noreferrer'
              aria-label='Developer WhatsApp'
              data-testid='dev-link-whatsapp'
              className='inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg neu-surface border-red-400/25 text-red-300 text-[11px] font-semibold'
            >
              <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                <path d='M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' />
              </svg>
              <span className='hidden sm:inline'>WhatsApp</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export const Waitlist = Waitlist04;
export default Waitlist04;
