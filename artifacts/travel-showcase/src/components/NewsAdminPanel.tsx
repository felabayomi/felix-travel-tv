import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Settings2, Loader2, Eye, EyeOff, Lock, Link, FileText, ChevronDown, ChevronUp, CalendarDays } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateArticle, getGetArticlesQueryKey } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';

const SOURCE_KEY = 'newsreader_last_source';

interface NewsAdminPanelProps {
  onArticleAdded: () => void;
}

export function NewsAdminPanel({ onArticleAdded }: NewsAdminPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [articleText, setArticleText] = useState('');
  const [source, setSource] = useState(() => localStorage.getItem(SOURCE_KEY) ?? '');
  const [articleDate, setArticleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [showTextArea, setShowTextArea] = useState(true);
  const [addError, setAddError] = useState('');
  const [addStatus, setAddStatus] = useState<{ tone: 'ai' | 'fallback'; message: string } | null>(null);

  const CORRECT_PIN = import.meta.env.VITE_ADMIN_PIN ?? '1234';
  const STORAGE_KEY = 'newsreader_admin_auth';

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() =>
    localStorage.getItem(STORAGE_KEY) === 'true' || sessionStorage.getItem(STORAGE_KEY) === 'true'
  );
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [pinError, setPinError] = useState('');

  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setShowPinDialog(true);
      }
    }
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === CORRECT_PIN) {
      if (keepSignedIn) localStorage.setItem(STORAGE_KEY, 'true');
      else sessionStorage.setItem(STORAGE_KEY, 'true');
      setIsAuthenticated(true);
      setShowPinDialog(false);
      setPin('');
      setIsOpen(true);
    } else {
      setPinError('Incorrect PIN — try again.');
      setPin('');
    }
  };

  const handleClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsOpen(false);
    setAddStatus(null);
    if (!keepSignedIn && !localStorage.getItem(STORAGE_KEY)) {
      sessionStorage.removeItem(STORAGE_KEY);
      setIsAuthenticated(false);
    }
  };

  useEffect(() => () => {
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const queryClient = useQueryClient();

  const createMutation = useCreateArticle({
    mutation: {
      onSuccess: (data: any) => {
        setUrl('');
        setArticleText('');
        setAddError('');
        const generationMode = data?.generation?.mode === 'fallback' ? 'fallback' : 'ai';
        const generationMessage = data?.generation?.message
          || (generationMode === 'fallback'
            ? 'Fallback content was used because AI generation failed.'
            : 'AI generation completed successfully.');
        setAddStatus({ tone: generationMode, message: generationMessage });
        queryClient.invalidateQueries({ queryKey: getGetArticlesQueryKey() });
        onArticleAdded();

        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(() => {
          handleClose();
        }, generationMode === 'fallback' ? 4500 : 2400);
      },
      onError: (err: any) => {
        if (closeTimerRef.current) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
        setAddStatus(null);
        setAddError(err?.data?.error || 'Failed to process — please check the URL and try again.');
      }
    }
  });

  const hasText = articleText.trim().length > 100;
  const canSubmit = url.trim().length > 0 && !createMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setAddError('');
    setAddStatus(null);
    if (source.trim()) localStorage.setItem(SOURCE_KEY, source.trim());
    createMutation.mutate({
      data: {
        url: url.trim(),
        ...(hasText ? { text: articleText.trim() } : {}),
        ...(source.trim() ? { source: source.trim() } : {}),
        ...(articleDate ? { publishedDate: articleDate } : {}),
      } as any,
    });
  };

  return (
    <>
      {/* Gear trigger — 6 taps */}
      <button
        onClick={handleGearTap}
        className={cn(
          "fixed bottom-6 right-6 p-3 rounded-full bg-black/20 text-white/40 backdrop-blur-md",
          "hover:bg-black/50 hover:text-white transition-all duration-300 z-40 group",
          (isOpen || showPinDialog) && "opacity-0 pointer-events-none"
        )}
        title="Admin"
      >
        <Settings2 className="w-5 h-5 group-hover:rotate-90 transition-transform duration-700" />
      </button>

      {/* PIN dialog */}
      <AnimatePresence>
        {showPinDialog && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowPinDialog(false)}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50" />
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={{ type: 'spring', damping: 22, stiffness: 260 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none"
            >
              <form onSubmit={handlePinSubmit}
                className="pointer-events-auto w-full max-w-xs bg-card border border-border rounded-2xl p-8 shadow-2xl space-y-6"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex flex-col items-center gap-3">
                  <div className="p-3 rounded-full bg-primary/10 border border-primary/20">
                    <Lock className="w-6 h-6 text-primary" />
                  </div>
                  <h2 className="text-lg font-display font-bold text-foreground">Admin Access</h2>
                  <p className="text-xs text-muted-foreground text-center">Enter your PIN to manage articles</p>
                </div>
                <div className="space-y-2">
                  <div className="relative">
                    <input autoFocus type={showPin ? 'text' : 'password'} inputMode="numeric"
                      placeholder="Enter PIN" value={pin}
                      onChange={e => { setPin(e.target.value); setPinError(''); }}
                      className="w-full bg-background border border-border rounded-xl px-4 pr-11 py-3 text-center text-xl tracking-widest font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                    />
                    <button type="button" onClick={() => setShowPin(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1}>
                      {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {pinError && <p className="text-xs text-destructive text-center">{pinError}</p>}
                </div>
                <label className="flex items-center gap-3 cursor-pointer select-none group">
                  <div onClick={() => setKeepSignedIn(v => !v)}
                    className={cn("w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
                      keepSignedIn ? "bg-primary border-primary" : "border-border bg-background group-hover:border-primary/60")}>
                    {keepSignedIn && (
                      <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 12 12">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Keep me signed in</span>
                </label>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowPinDialog(false)}
                    className="flex-1 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:bg-white/5 transition-all">Cancel</button>
                  <button type="submit" disabled={!pin}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary/20">Unlock</button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Admin panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={handleClose}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-lg bg-card border-l border-border z-50 flex flex-col shadow-2xl overflow-y-auto"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-card z-10">
                <div>
                  <h2 className="text-xl font-display font-bold text-foreground">Add Article</h2>
                  <p className="text-xs text-muted-foreground mt-1">Paste the article text for best results</p>
                </div>
                <button onClick={handleClose} className="p-2 rounded-full hover:bg-white/10 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-5">

                {/* URL field */}
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Link className="w-3.5 h-3.5" />
                    Article URL <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="url"
                    placeholder="https://example.com/news/article"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    disabled={createMutation.isPending}
                    required
                    className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground/40"
                  />
                  <p className="text-[11px] text-muted-foreground/50">Used for attribution and linking back to the original</p>
                </div>

                {/* Source + Date row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground block">
                      Source name
                      {localStorage.getItem(SOURCE_KEY) && (
                        <span className="ml-1.5 text-[10px] text-primary/60">(saved)</span>
                      )}
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Daily Felix…"
                      value={source}
                      onChange={e => setSource(e.target.value)}
                      disabled={createMutation.isPending}
                      className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground/40"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      <CalendarDays className="w-3.5 h-3.5" />
                      Article date
                    </label>
                    <input
                      type="date"
                      value={articleDate}
                      onChange={e => setArticleDate(e.target.value)}
                      disabled={createMutation.isPending}
                      className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-foreground"
                    />
                  </div>
                </div>

                {/* Article text toggle */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowTextArea(v => !v)}
                    className="flex items-center gap-2 text-sm font-medium text-foreground/80 hover:text-foreground transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-primary" />
                    Paste article text
                    <span className="ml-1 text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full font-medium uppercase tracking-wide">
                      Recommended
                    </span>
                    {showTextArea ? <ChevronUp className="w-3.5 h-3.5 ml-auto opacity-50" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto opacity-50" />}
                  </button>

                  {showTextArea && (
                    <div className="space-y-1.5">
                      <textarea
                        placeholder="Open the article in your browser, select all the text (Ctrl+A or Cmd+A), copy it, and paste it here. This gives the AI the full article to work with and produces much better chapters."
                        value={articleText}
                        onChange={e => setArticleText(e.target.value)}
                        disabled={createMutation.isPending}
                        rows={10}
                        className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground/30 resize-none leading-relaxed"
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-muted-foreground/50">
                          {hasText
                            ? <span className="text-primary">✓ Text ready — AI will use this to create chapters</span>
                            : 'Without text, the AI will try to read the URL directly (may not work for all sites)'}
                        </p>
                        <span className="text-[11px] text-muted-foreground/40">{articleText.length.toLocaleString()} chars</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Error */}
                {addError && (
                  <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{addError}</p>
                )}

                {addStatus && (
                  <p className={cn(
                    'text-xs rounded-lg px-3 py-2 border',
                    addStatus.tone === 'fallback'
                      ? 'text-amber-200 bg-amber-500/10 border-amber-500/30'
                      : 'text-emerald-200 bg-emerald-500/10 border-emerald-500/30'
                  )}>
                    {addStatus.message}
                  </p>
                )}

                {/* Processing indicator */}
                {createMutation.isPending && (
                  <div className="bg-primary/10 border border-primary/20 rounded-xl px-4 py-3 space-y-1">
                    <p className="text-xs font-medium text-primary flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {hasText ? 'Breaking article into chapters...' : 'Reading article and creating chapters...'}
                    </p>
                    <p className="text-[11px] text-primary/60">
                      Generating images for each chapter. This takes 30–60 seconds.
                    </p>
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary/20"
                >
                  {createMutation.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                    : <><Plus className="w-4 h-4" /> Create Story Chapters</>
                  }
                </button>

                {/* Tip */}
                <div className="p-4 rounded-xl border border-dashed border-border text-xs text-muted-foreground space-y-2">
                  <p className="font-medium text-foreground/60">How to copy article text</p>
                  <ol className="space-y-1 pl-4 list-decimal">
                    <li>Open the article in your browser</li>
                    <li>Click inside the article text area</li>
                    <li>Press <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[10px]">Ctrl+A</kbd> (or <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[10px]">Cmd+A</kbd> on Mac) to select all</li>
                    <li>Press <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[10px]">Ctrl+C</kbd> to copy</li>
                    <li>Paste it in the box above</li>
                  </ol>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
