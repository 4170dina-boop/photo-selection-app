'use client';

import type { InputHTMLAttributes } from 'react';
import { PRICE_STEP, priceStepBase } from '@/lib/priceStep';

type PriceInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'min' | 'step' | 'value'> & {
  value: string;
};

// שדה מחיר בש"ח שעולה/יורד ב-10 ₪ ועדיין מקבל כל סכום שמוקלד (ראו lib/priceStep.ts).
export default function PriceInput({ value, ...rest }: PriceInputProps) {
  return <input {...rest} type="number" min={priceStepBase(value)} step={PRICE_STEP} value={value} />;
}
