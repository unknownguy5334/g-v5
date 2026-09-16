import type { AppStep } from '../types';

export const STEP_HASHES: Record<AppStep, string> = { home: '#home', setup: '#setup', results: '#results' };
export type InfoModal = 'demo' | 'how-it-works' | 'privacy' | 'promise' | 'refund' | 'pricing' | 'access-billing' | 'about-us' | 'contact-us' | 'delivery-shipping';
export const INFO_MODAL_HASHES: Record<InfoModal, string> = {
  demo: '#guide',
  'how-it-works': '#how-it-works',
  promise: '#how-it-works',
  privacy: '#privacy',
  refund: '#refund',
  pricing: '#pricing',
  'access-billing': '#access-billing',
  'about-us': '#about-us',
  'contact-us': '#contact-us',
  'delivery-shipping': '#delivery-shipping',
};

export function isAppStep(value: unknown): value is AppStep {
  return value === 'home' || value === 'setup' || value === 'results';
}
export function isInfoModal(value: unknown): value is InfoModal {
  return value === 'demo' || value === 'how-it-works' || value === 'privacy' || value === 'promise' || value === 'refund' || value === 'pricing' || value === 'access-billing' || value === 'about-us' || value === 'contact-us' || value === 'delivery-shipping';
}
export function getInfoModalFromHash(hash: string): InfoModal | null {
  const h = hash.toLowerCase();
  if (h === '#promise' || h === '#why-gadwal' || h === '#how-it-works') {
    return 'how-it-works';
  }
  if (h === '#refund' || h === '#refund-policy' || h === '#refunds') {
    return 'refund';
  }
  if (h === '#pricing' || h === '#price') return 'pricing';
  if (h === '#access-billing' || h === '#billing' || h === '#access') return 'access-billing';
  if (h === '#about-us' || h === '#about') return 'about-us';
  if (h === '#contact-us' || h === '#contact') return 'contact-us';
  if (h === '#delivery-shipping' || h === '#delivery') return 'delivery-shipping';
  const found = Object.entries(INFO_MODAL_HASHES).find(([, v]) => v === h);
  return found ? found[0] as InfoModal : null;
}
export function getStepFromLocation(hash: string, pathname: string): AppStep | null {
  const h = hash.toLowerCase(); const p = pathname.toLowerCase();
  if (h === '#home' || (!h && p === '/home')) return 'home';
  if (h === '#setup' || (!h && p === '/setup')) return 'setup';
  if (h === '#results' || (!h && p === '/results')) return 'results';
  return null;
}
export function getStepHash(step: AppStep): string { return STEP_HASHES[step]; }
export function canonicalRoute(step: AppStep): string { return STEP_HASHES[step]; }
