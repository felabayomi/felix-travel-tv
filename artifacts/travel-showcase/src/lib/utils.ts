import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getCategoryGradient(category: string | null | undefined): string {
  const cat = (category || "").toLowerCase();
  
  if (cat.includes('ocean') || cat.includes('sea') || cat.includes('cruise')) {
    return 'bg-gradient-to-br from-slate-900 via-blue-900 to-cyan-900';
  }
  if (cat.includes('nature') || cat.includes('forest') || cat.includes('expedition')) {
    return 'bg-gradient-to-br from-stone-900 via-emerald-900 to-green-950';
  }
  if (cat.includes('city') || cat.includes('urban') || cat.includes('news')) {
    return 'bg-gradient-to-br from-zinc-900 via-purple-900 to-indigo-950';
  }
  if (cat.includes('desert') || cat.includes('safari') || cat.includes('discover')) {
    return 'bg-gradient-to-br from-neutral-900 via-orange-950 to-amber-950';
  }
  
  // Default luxurious dark gradient
  return 'bg-gradient-to-br from-gray-900 via-slate-900 to-zinc-950';
}
