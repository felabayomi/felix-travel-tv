import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getCategoryGradient(category: string | null | undefined): string {
  const cat = (category || "").toLowerCase();

  if (cat.includes('finance') || cat.includes('banking') || cat.includes('invest') || cat.includes('crypto')) {
    return 'bg-gradient-to-br from-slate-900 via-emerald-950 to-teal-950';
  }
  if (cat.includes('tech') || cat.includes('ai') || cat.includes('software') || cat.includes('digital') || cat.includes('productivity')) {
    return 'bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950';
  }
  if (cat.includes('education') || cat.includes('learning') || cat.includes('academic') || cat.includes('science')) {
    return 'bg-gradient-to-br from-stone-900 via-amber-950 to-yellow-950';
  }
  if (cat.includes('wildlife') || cat.includes('nature') || cat.includes('environment') || cat.includes('expedition')) {
    return 'bg-gradient-to-br from-stone-900 via-emerald-900 to-green-950';
  }
  if (cat.includes('news') || cat.includes('media') || cat.includes('city') || cat.includes('urban') || cat.includes('local')) {
    return 'bg-gradient-to-br from-zinc-900 via-purple-900 to-indigo-950';
  }
  if (cat.includes('health') || cat.includes('wellness') || cat.includes('fitness')) {
    return 'bg-gradient-to-br from-slate-900 via-rose-950 to-pink-950';
  }
  if (cat.includes('travel') || cat.includes('tour') || cat.includes('navigation') || cat.includes('itinerary')) {
    return 'bg-gradient-to-br from-slate-900 via-sky-900 to-cyan-900';
  }
  if (cat.includes('discover') || cat.includes('ocean') || cat.includes('safari')) {
    return 'bg-gradient-to-br from-neutral-900 via-orange-950 to-amber-950';
  }

  // Default luxurious dark gradient
  return 'bg-gradient-to-br from-gray-900 via-slate-900 to-zinc-950';
}
