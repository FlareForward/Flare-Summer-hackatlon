'use client';

import type { Address, Hex } from 'viem';

export type SpectraExecutionStage =
  | 'preparing'
  | 'awaiting_signature'
  | 'xrpl_submitted'
  | 'flare_submitted'
  | 'complete'
  | 'error';

export type SpectraExecutionState = {
  action: 'buy' | 'sell';
  marketSymbol: string;
  personalAccount?: Address;
  expectedNonce?: string;
  userOpHash?: Hex;
  xrplTxHash?: string;
  flareTxHash?: Hex;
  stage: SpectraExecutionStage;
  message: string;
  updatedAt: number;
};

const STORAGE_KEY = 'flare.spectra.execution';
export const SPECTRA_EXECUTION_EVENT = 'flare:spectra-execution';

export function readSpectraExecution(): SpectraExecutionState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as SpectraExecutionState : null;
  } catch {
    return null;
  }
}

export function writeSpectraExecution(state: SpectraExecutionState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(SPECTRA_EXECUTION_EVENT, { detail: state }));
}

export function updateSpectraExecution(patch: Partial<SpectraExecutionState>) {
  const current = readSpectraExecution();
  if (!current) return;
  writeSpectraExecution({ ...current, ...patch, updatedAt: Date.now() });
}

