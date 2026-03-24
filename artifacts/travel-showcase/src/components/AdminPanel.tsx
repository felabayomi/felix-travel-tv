import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { 
  X, Plus, Trash2, ArrowUp, ArrowDown, ExternalLink, 
  Settings2, Loader2, Image as ImageIcon, Eye, EyeOff, Pencil, Sparkles, XCircle, Search, Lock
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { 
  useGetSlides, 
  useCreateSlide, 
  useDeleteSlide, 
  useReorderSlide,
  useRegenerateSlide,
  getGetSlidesQueryKey
} from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import type { Slide } from '@workspace/api-client-react/src/generated/api.schemas';

interface AdminPanelProps {
  goTo: (index: number) => void;
  requestJumpToNext: () => void;
}

export function AdminPanel({ goTo, requestJumpToNext }: AdminPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [hint, setHint] = useState('');
  const [editError, setEditError] = useState('');
  const [search, setSearch] = useState('');

  // ── Auth / PIN protection ──────────────────────────────────────────────
  const CORRECT_PIN = import.meta.env.VITE_ADMIN_PIN ?? '1234';
  const STORAGE_KEY = 'showcase_admin_auth';

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return (
      localStorage.getItem(STORAGE_KEY) === 'true' ||
      sessionStorage.getItem(STORAGE_KEY) === 'true'
    );
  });
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [pinError, setPinError] = useState('');

  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleGearTap = () => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 1500);

    if (tapCountRef.current >= 6) {
      tapCountRef.current = 0;
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      if (isAuthenticated) {
        setIsOpen(true);
      } else {
        setPin('');
        setPinError('');
        setShowPin(false);
        setShowPinDialog(true);
      }
    }
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === CORRECT_PIN) {
      if (keepSignedIn) {
        localStorage.setItem(STORAGE_KEY, 'true');
      } else {
        sessionStorage.setItem(STORAGE_KEY, 'true');
      }
      setIsAuthenticated(true);
      setShowPinDialog(false);
      setPin('');
      setIsOpen(true);
    } else {
      setPinError('Incorrect PIN — try again.');
      setPin('');
    }
  };

  const handlePanelClose = () => {
    setIsOpen(false);
    if (!keepSignedIn && !localStorage.getItem(STORAGE_KEY)) {
      sessionStorage.removeItem(STORAGE_KEY);
      setIsAuthenticated(false);
    }
  };

  // Cleanup tap timer on unmount
  useEffect(() => () => { if (tapTimerRef.current) clearTimeout(tapTimerRef.current); }, []);
  // ──────────────────────────────────────────────────────────────────────

  const queryClient = useQueryClient();
  const invalidateSlides = () => queryClient.invalidateQueries({ queryKey: getGetSlidesQueryKey() });

  const { data: slides = [], isLoading: isLoadingSlides } = useGetSlides();
  
  const createMutation = useCreateSlide({
    mutation: {
      onSuccess: () => {
        setNewUrl('');
        setAddError('');
        // Signal ShowcasePage to jump once the new slide arrives in the data
        requestJumpToNext();
        setIsOpen(false);
        invalidateSlides();
      },
      onError: (err: any) => {
        setAddError(err?.data?.error || 'Failed to process URL');
      }
    }
  });

  const deleteMutation = useDeleteSlide({
    mutation: { onSuccess: invalidateSlides }
  });

  const reorderMutation = useReorderSlide({
    mutation: { onSuccess: invalidateSlides }
  });

  const regenerateMutation = useRegenerateSlide({
    mutation: {
      onSuccess: () => {
        invalidateSlides();
        setEditingId(null);
        setHint('');
        setEditError('');
      },
      onError: () => {
        setEditError('Regeneration failed — please try again.');
      }
    }
  });

  const handleAddUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl) return;
    setAddError('');
    createMutation.mutate({ data: { url: newUrl } });
  };

  const handleReorder = (slide: Slide, direction: 'up' | 'down', index: number) => {
    if (direction === 'up' && index > 0) {
      reorderMutation.mutate({ id: slide.id, data: { displayOrder: slides[index - 1].displayOrder - 1 } });
    } else if (direction === 'down' && index < slides.length - 1) {
      reorderMutation.mutate({ id: slide.id, data: { displayOrder: slides[index + 1].displayOrder + 1 } });
    }
  };

  const startEdit = (slide: Slide) => {
    setEditingId(slide.id);
    setHint('');
    setEditError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setHint('');
    setEditError('');
  };

  const handleRegenerate = (id: number) => {
    if (!hint.trim()) return;
    regenerateMutation.mutate({ id, data: { hint: hint.trim() } });
  };

  const handleView = (index: number) => {
    setIsOpen(false);
    setTimeout(() => goTo(index), 200);
  };

  const q = search.trim().toLowerCase();
  const filteredSlides = q
    ? slides.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.tagline.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.url.toLowerCase().includes(q) ||
        (s.summary ?? '').toLowerCase().includes(q)
      )
    : slides;

  return (
    <>
      {/* Gear button — invisible tap target, requires 6 quick taps */}
      <button 
        onClick={handleGearTap}
        className={cn(
          "fixed bottom-6 right-6 p-3 rounded-full bg-black/20 text-white/50 backdrop-blur-md",
          "hover:bg-black/50 hover:text-white transition-all duration-300 z-40 group",
          (isOpen || showPinDialog) && "opacity-0 pointer-events-none"
        )}
        title="Admin"
      >
        <Settings2 className="w-5 h-5 group-hover:rotate-90 transition-transform duration-700" />
      </button>

      {/* ── PIN dialog ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {showPinDialog && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPinDialog(false)}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={{ type: 'spring', damping: 22, stiffness: 260 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none"
            >
              <form
                onSubmit={handlePinSubmit}
                className="pointer-events-auto w-full max-w-xs bg-card border border-border rounded-2xl p-8 shadow-2xl space-y-6"
                onClick={e => e.stopPropagation()}
              >
                {/* Icon + title */}
                <div className="flex flex-col items-center gap-3">
                  <div className="p-3 rounded-full bg-primary/10 border border-primary/20">
                    <Lock className="w-6 h-6 text-primary" />
                  </div>
                  <h2 className="text-lg font-display font-bold text-foreground">Admin Access</h2>
                  <p className="text-xs text-muted-foreground text-center">Enter your PIN to continue</p>
                </div>

                {/* PIN input */}
                <div className="space-y-2">
                  <div className="relative">
                    <input
                      autoFocus
                      type={showPin ? 'text' : 'password'}
                      inputMode="numeric"
                      placeholder="Enter PIN"
                      value={pin}
                      onChange={e => { setPin(e.target.value); setPinError(''); }}
                      className="w-full bg-background border border-border rounded-xl px-4 pr-11 py-3 text-center text-xl tracking-widest font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {pinError && (
                    <p className="text-xs text-destructive text-center">{pinError}</p>
                  )}
                </div>

                {/* Keep me signed in */}
                <label className="flex items-center gap-3 cursor-pointer select-none group">
                  <div
                    onClick={() => setKeepSignedIn(v => !v)}
                    className={cn(
                      "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
                      keepSignedIn
                        ? "bg-primary border-primary"
                        : "border-border bg-background group-hover:border-primary/60"
                    )}
                  >
                    {keepSignedIn && (
                      <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 12 12">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                    Keep me signed in
                  </span>
                </label>

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowPinDialog(false)}
                    className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:bg-white/5 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!pin}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary/20"
                  >
                    Unlock
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Admin panel ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handlePanelClose}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />
            
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-card border-l border-border z-50 flex flex-col shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-border">
                <div>
                  <h2 className="text-xl font-display font-bold text-foreground">Showcase Control</h2>
                  <p className="text-xs text-muted-foreground mt-1">Manage your active products</p>
                </div>
                <button 
                  onClick={handlePanelClose}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Add URL form */}
              <div className="p-6 border-b border-border bg-black/20">
                <form onSubmit={handleAddUrl} className="space-y-3">
                  <label className="text-sm font-medium text-muted-foreground">Add New Product URL</label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      placeholder="https://example.com/product"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      disabled={createMutation.isPending}
                      className="flex-1 bg-background border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground/50"
                      required
                    />
                    <button
                      type="submit"
                      disabled={createMutation.isPending || !newUrl}
                      className="bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium flex items-center justify-center min-w-[100px] hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary/20"
                    >
                      {createMutation.isPending
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <span className="flex items-center gap-2"><Plus className="w-4 h-4" /> Add</span>}
                    </button>
                  </div>
                  {addError && <p className="text-xs text-destructive">{addError}</p>}
                  {createMutation.isPending && (
                    <p className="text-xs text-primary animate-pulse flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> Analyzing page &amp; generating visuals...
                    </p>
                  )}
                </form>
              </div>

              {/* Slides list */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                      Active Slides ({slides.length})
                    </h3>
                    {q && (
                      <span className="text-xs text-primary">
                        {filteredSlides.length} result{filteredSlides.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {/* Search box */}
                  {slides.length > 0 && (
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Search by title, category, URL…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground/40"
                      />
                      {search && (
                        <button
                          onClick={() => setSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isLoadingSlides ? (
                  <div className="flex justify-center p-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : slides.length === 0 ? (
                  <div className="text-center p-8 border border-dashed border-border rounded-xl">
                    <p className="text-sm text-muted-foreground">No products added yet.</p>
                  </div>
                ) : filteredSlides.length === 0 ? (
                  <div className="text-center p-8 border border-dashed border-border rounded-xl">
                    <p className="text-sm text-muted-foreground">No slides match "{search}".</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredSlides.map((slide) => {
                      const index = slides.indexOf(slide);
                      return (<div key={slide.id} className="group bg-background border border-border rounded-xl overflow-hidden hover:border-primary/40 transition-colors">

                        {/* Normal card view */}
                        {editingId !== slide.id ? (
                          <div className="flex">
                            {/* Thumbnail */}
                            <div className="w-24 h-24 shrink-0 bg-secondary flex items-center justify-center relative overflow-hidden">
                              {slide.imageUrl ? (
                                <img src={slide.imageUrl} alt={slide.title} className="w-full h-full object-cover" />
                              ) : (
                                <ImageIcon className="w-6 h-6 text-muted-foreground/30" />
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                              <span className="absolute bottom-1 left-2 text-[10px] font-bold text-white uppercase tracking-wider">
                                {slide.category}
                              </span>
                            </div>

                            {/* Info + actions */}
                            <div className="p-3 flex-1 min-w-0 flex flex-col justify-between">
                              <div>
                                <h4 className="font-display font-bold text-sm truncate text-foreground">{slide.title}</h4>
                                <p className="text-xs text-muted-foreground truncate">{slide.tagline}</p>
                              </div>
                              
                              <div className="flex items-center justify-between mt-2">
                                <span className="text-[10px] text-muted-foreground/50">
                                  {format(new Date(slide.createdAt), 'MMM d, yyyy')}
                                </span>
                                <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleView(index)}
                                    title="Jump to this slide"
                                    className="p-1.5 rounded bg-secondary hover:text-primary transition-colors"
                                  >
                                    <Eye className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => startEdit(slide)}
                                    title="Fix with AI"
                                    className="p-1.5 rounded bg-secondary hover:text-primary transition-colors"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <a href={slide.url} target="_blank" rel="noreferrer"
                                    className="p-1.5 rounded bg-secondary hover:text-primary transition-colors">
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                  <div className="flex flex-col gap-0.5 ml-1">
                                    <button 
                                      onClick={() => handleReorder(slide, 'up', index)}
                                      disabled={index === 0 || reorderMutation.isPending}
                                      className="p-0.5 bg-secondary rounded hover:text-primary disabled:opacity-30 transition-colors"
                                    >
                                      <ArrowUp className="w-3 h-3" />
                                    </button>
                                    <button 
                                      onClick={() => handleReorder(slide, 'down', index)}
                                      disabled={index === slides.length - 1 || reorderMutation.isPending}
                                      className="p-0.5 bg-secondary rounded hover:text-primary disabled:opacity-30 transition-colors"
                                    >
                                      <ArrowDown className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <button 
                                    onClick={() => {
                                      if (confirm('Delete this slide?')) {
                                        deleteMutation.mutate({ id: slide.id });
                                      }
                                    }}
                                    disabled={deleteMutation.isPending}
                                    className="p-1.5 ml-1 rounded bg-secondary hover:bg-destructive/20 hover:text-destructive transition-colors"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* Regenerate panel */
                          <div className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 text-primary">
                                <Sparkles className="w-4 h-4" />
                                <span className="text-xs font-semibold uppercase tracking-wider">Fix with AI</span>
                              </div>
                              <button onClick={cancelEdit} className="p-1 rounded hover:bg-white/10 transition-colors">
                                <XCircle className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                              </button>
                            </div>

                            <p className="text-xs text-muted-foreground leading-relaxed">
                              Describe what <span className="text-foreground font-medium">{slide.title}</span> actually does in one sentence and AI will rewrite everything.
                            </p>

                            <textarea
                              value={hint}
                              onChange={e => setHint(e.target.value)}
                              placeholder="e.g. It's a meditation app that helps you fall asleep faster using guided breathing"
                              rows={3}
                              disabled={regenerateMutation.isPending}
                              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all resize-none placeholder:text-muted-foreground/40"
                            />

                            {editError && <p className="text-xs text-destructive">{editError}</p>}

                            {regenerateMutation.isPending && (
                              <p className="text-xs text-primary animate-pulse flex items-center gap-2">
                                <Loader2 className="w-3 h-3 animate-spin" /> Regenerating content...
                              </p>
                            )}

                            <button
                              onClick={() => handleRegenerate(slide.id)}
                              disabled={!hint.trim() || regenerateMutation.isPending}
                              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary/20"
                            >
                              {regenerateMutation.isPending
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <><Sparkles className="w-4 h-4" /> Regenerate</>}
                            </button>
                          </div>
                        )}
                      </div>);
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
