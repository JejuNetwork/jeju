import { type ClassValue, clsx } from '.bun/clsx@2.1.1/node_modules/clsx/clsx.d.mts';
import { twMerge } from '.bun/tailwind-merge@3.3.1/node_modules/tailwind-merge/dist/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
