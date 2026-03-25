import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Edit3, Check, X,
  Mic, MicOff, Lock, Eye, EyeOff, ExternalLink, Radio,
  Loader2, FileText, Link, CalendarDays, ChevronDown, ChevronUp,
  Settings2, RotateCcw, Play, Pause
} from 'lucide-react';
import {
  useGetArticles, useGetArticleSnippets, useCreateArticle,
  useDeleteArticle, getGetArticlesQueryKey,
} from '@workspace/api-client-react';
import type { Article, Snippet } from '@workspace/api-client-react/src/generated/api.schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useVoiceReader } from '@/hooks/use-voice-reader';
import { cn } from '@/lib/utils';

const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN ?? '1234';
const AUTH_KEY = 'newsreader_admin_auth';
const SOURCE_KEY = 'newsreader_last_source';

// ─── Playback API helpers ──────────────────────────────────────────────────
async function setPlayback(articleId: number | null, snippetIndex: number) {
  await fetch('/api/playback', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articleId, snippetIndex }),
  });
}

async function patchSnippet(id: number, fields: { headline?: string; caption?: string; explanation?: string }) {
  const res = await fetch(`/api/snippets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error('Failed to save');
  return res.json();
}

async function patchArticle(id: number, fields: { title?: string; source?: string }) {
  const res = await fetch(`/api/articles/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error('Failed to save');
  return res.json();
}

// ─── PIN Gate ─────────────────────────────────────────────────────────────
function PinGate({ onAuth }: { onAuth: () => void }) {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === ADMIN_PIN) {
      sessionStorage.setItem(AUTH_KEY, 'true');
      onAuth();
    } else {
      setError('Incorrect PIN');
      setPin('');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs bg-card border border-border rounded-2xl p-8 space-y-6 shadow-2xl">
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 rounded-full bg-primary/10 border border-primary/20">
            <Lock className="w-6 h-6 text-primary" />
          </div>
          <h2 className="text-xl font-display font-bold text-foreground">Admin Access</h2>
          <p className="text-xs text-muted-foreground text-center">Enter your PIN to access the control panel</p>
        </div>
        <div className="space-y-2">
          <div className="relative">
            <input
              autoFocus type={showPin ? 'text' : 'password'} inputMode="numeric"
              placeholder="Enter PIN" value={pin}
              onChange={e => { setPin(e.target.value); setError(''); }}
              className="w-full bg-background border border-border rounded-xl px-4 pr-11 py-3 text-center text-2xl tracking-widest font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
            />
            <button type="button" onClick={() => setShowPin(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {error && <p className="text-xs text-destructive text-center">{error}</p>}
        </div>
        <button type="submit" disabled={!pin}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-40 transition-all"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}

// ─── Snippet Editor Row ────────────────────────────────────────────────────
function SnippetRow({
  snippet, index, totalChapters, isOnAir, onSelect,
}: {
  snippet: Snippet; index: number; totalChapters: number; isOnAir: boolean;
  onSelect: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [headline, setHeadline] = useState(snippet.headline);
  const [caption, setCaption] = useState(snippet.caption);
  const [explanation, setExplanation] = useState(snippet.explanation);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await patchSnippet(snippet.id, { headline, caption, explanation });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setEditing(false);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleCancel = () => {
    setHeadline(snippet.headline);
    setCaption(snippet.caption);
    setExplanation(snippet.explanation);
    setEditing(false);
  };

  return (
    <div className={cn(
      "rounded-xl border transition-all",
      isOnAir ? "border-primary/40 bg-primary/5" : "border-border bg-card/30 hover:bg-card/60",
    )}>
      {/* Row header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={onSelect}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <span className={cn(
            "text-xs font-mono shrink-0 w-6 h-6 rounded-full flex items-center justify-center font-bold",
            isOnAir ? "bg-primary text-primary-foreground" : "bg-white/10 text-white/40"
          )}>
            {index + 1}
          </span>
          <span className={cn(
            "text-sm truncate leading-tight",
            isOnAir ? "text-white font-medium" : "text-white/60"
          )}>
            {headline}
          </span>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          {isOnAir && (
            <span className="text-[10px] text-primary font-medium uppercase tracking-wider flex items-center gap-1">
              <Radio className="w-2.5 h-2.5 animate-pulse" /> On Air
            </span>
          )}
          <button
            onClick={() => setEditing(v => !v)}
            className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-all"
            title="Edit chapter"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Edit form */}
      <AnimatePresence initial={false}>
        {editing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground uppercase tracking-widest">Headline</label>
                <input
                  value={headline}
                  onChange={e => setHeadline(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground uppercase tracking-widest">Caption</label>
                <input
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground uppercase tracking-widest">Explanation</label>
                <textarea
                  value={explanation}
                  onChange={e => setExplanation(e.target.value)}
                  rows={4}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-all resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : saved ? <Check className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                  {saved ? 'Saved!' : 'Save'}
                </button>
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-white/5 transition-all"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Add Article Drawer ────────────────────────────────────────────────────
function AddArticleDrawer({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [source, setSource] = useState(() => localStorage.getItem(SOURCE_KEY) ?? '');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [showText, setShowText] = useState(true);
  const [error, setError] = useState('');

  const createMutation = useCreateArticle({
    mutation: {
      onSuccess: () => {
        localStorage.setItem(SOURCE_KEY, source.trim());
        queryClient.invalidateQueries({ queryKey: getGetArticlesQueryKey() });
        onAdded();
        onClose();
      },
      onError: (err: any) => setError(err?.data?.error || 'Failed to process article.'),
    },
  });

  const hasText = text.trim().length > 100;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setError('');
    createMutation.mutate({
      data: {
        url: url.trim(),
        ...(hasText ? { text: text.trim() } : {}),
        ...(source.trim() ? { source: source.trim() } : {}),
        ...(date ? { publishedDate: date } : {}),
      } as any,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="relative ml-auto w-full max-w-md bg-card border-l border-border flex flex-col shadow-2xl overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-card z-10">
          <div>
            <h2 className="text-lg font-display font-bold">Add Article</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Paste article text for best AI results</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Link className="w-3.5 h-3.5" /> Article URL <span className="text-destructive">*</span>
            </label>
            <input type="url" required placeholder="https://example.com/article"
              value={url} onChange={e => setUrl(e.target.value)} disabled={createMutation.isPending}
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-all placeholder:text-muted-foreground/40"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground block">Source</label>
              <input type="text" placeholder="e.g. BBC News"
                value={source} onChange={e => setSource(e.target.value)} disabled={createMutation.isPending}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-all placeholder:text-muted-foreground/40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <CalendarDays className="w-3.5 h-3.5" /> Date
              </label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={createMutation.isPending}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-all text-foreground"
              />
            </div>
          </div>
          <div className="space-y-2">
            <button type="button" onClick={() => setShowText(v => !v)}
              className="flex items-center gap-2 text-sm font-medium text-foreground/80 hover:text-foreground w-full text-left"
            >
              <FileText className="w-3.5 h-3.5 text-primary" />
              Paste article text
              <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full font-medium uppercase tracking-wide ml-1">Recommended</span>
              {showText ? <ChevronUp className="w-3.5 h-3.5 ml-auto opacity-50" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto opacity-50" />}
            </button>
            {showText && (
              <textarea
                placeholder="Select all text in the article (Ctrl+A), copy and paste here..."
                value={text} onChange={e => setText(e.target.value)} disabled={createMutation.isPending}
                rows={8}
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary transition-all placeholder:text-muted-foreground/30 resize-none"
              />
            )}
          </div>
          {error && <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>}
          {createMutation.isPending && (
            <div className="bg-primary/10 border border-primary/20 rounded-xl px-4 py-3">
              <p className="text-xs text-primary flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Creating chapters & generating images... (~60s)
              </p>
            </div>
          )}
          <button type="submit" disabled={!url.trim() || createMutation.isPending}
            className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 disabled:opacity-50 transition-all"
          >
            {createMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</> : <><Plus className="w-4 h-4" /> Create Story Chapters</>}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Article Meta Editor ──────────────────────────────────────────────────
function ArticleMetaEditor({ article, onSaved }: { article: Article; onSaved: (a: Article) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(article.title);
  const [source, setSource] = useState(article.source ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await patchArticle(article.id, { title, source });
      onSaved(updated);
      setEditing(false);
    } catch { /* ignore */ }
    setSaving(false);
  };

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">{source || 'No source'}</p>
          <h2 className="text-base font-semibold text-white leading-snug line-clamp-2">{title}</h2>
        </div>
        <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-all shrink-0 mt-1">
          <Edit3 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input value={title} onChange={e => setTitle(e.target.value)}
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-all font-semibold"
      />
      <input value={source} onChange={e => setSource(e.target.value)}
        placeholder="Source name"
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-all"
      />
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
        </button>
        <button onClick={() => { setTitle(article.title); setSource(article.source ?? ''); setEditing(false); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-white/5"
        >
          <X className="w-3 h-3" /> Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main Admin Page ───────────────────────────────────────────────────────
export function AdminPage() {
  const [authed, setAuthed] = useState(
    () => sessionStorage.getItem(AUTH_KEY) === 'true' || localStorage.getItem(AUTH_KEY) === 'true'
  );

  if (!authed) return <PinGate onAuth={() => setAuthed(true)} />;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const queryClient = useQueryClient();
  const { data: articles = [], isLoading } = useGetArticles();

  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const [currentSnippetIndex, setCurrentSnippetIndex] = useState(0);
  const [showAddDrawer, setShowAddDrawer] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const AUTO_PLAY_SECONDS = 15;
  const [articleOverrides, setArticleOverrides] = useState<Record<number, Partial<Article>>>({});

  // Auto-select first article
  useEffect(() => {
    if (articles.length > 0 && selectedArticleId === null) {
      const first = articles[0];
      setSelectedArticleId(first.id);
      setCurrentSnippetIndex(0);
      setPlayback(first.id, 0).catch(() => {});
    }
  }, [articles, selectedArticleId]);

  const { data: snippets = [], isLoading: isLoadingSnippets } = useGetArticleSnippets(
    selectedArticleId ?? 0,
    { query: { enabled: selectedArticleId !== null } }
  );

  const deleteMutation = useDeleteArticle({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetArticlesQueryKey() });
        setSelectedArticleId(null);
        setCurrentSnippetIndex(0);
        setPlayback(null, 0).catch(() => {});
      }
    }
  });

  const { speak, stop, isLoading: isVoiceLoading } = useVoiceReader(voiceEnabled);

  // When snippet changes (via nav), update server + speak
  const prevIndexRef = useRef(-1);
  const updatePlayback = useCallback(async (articleId: number, index: number) => {
    setCurrentSnippetIndex(index);
    await setPlayback(articleId, index);
  }, []);

  const handleNext = useCallback(() => {
    if (!selectedArticleId || snippets.length === 0) return;
    const next = Math.min(currentSnippetIndex + 1, snippets.length - 1);
    updatePlayback(selectedArticleId, next);
  }, [selectedArticleId, snippets.length, currentSnippetIndex, updatePlayback]);

  const handlePrev = useCallback(() => {
    if (!selectedArticleId || snippets.length === 0) return;
    const prev = Math.max(currentSnippetIndex - 1, 0);
    updatePlayback(selectedArticleId, prev);
  }, [selectedArticleId, snippets.length, currentSnippetIndex, updatePlayback]);

  useEffect(() => {
    if (!voiceEnabled || !snippets[currentSnippetIndex]) return;
    if (prevIndexRef.current === currentSnippetIndex) return;
    prevIndexRef.current = currentSnippetIndex;
    const isLastChapter = currentSnippetIndex >= snippets.length - 1;
    speak(
      snippets[currentSnippetIndex].id,
      autoPlay && !isLastChapter ? handleNext : undefined,
    );
  }, [currentSnippetIndex, snippets, voiceEnabled, speak, autoPlay, handleNext]);

  // Timer-based auto-advance when voice is off
  useEffect(() => {
    if (!autoPlay || voiceEnabled || !selectedArticleId || snippets.length === 0) return;
    if (currentSnippetIndex >= snippets.length - 1) return;
    const timer = setTimeout(() => handleNext(), AUTO_PLAY_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [autoPlay, voiceEnabled, currentSnippetIndex, snippets.length, selectedArticleId, handleNext]);

  const handleSelectArticle = async (article: Article) => {
    stop();
    prevIndexRef.current = -1;
    setSelectedArticleId(article.id);
    setCurrentSnippetIndex(0);
    await setPlayback(article.id, 0);
  };

  const handleSelectChapter = (index: number) => {
    if (!selectedArticleId) return;
    updatePlayback(selectedArticleId, index);
  };

  const handleArticleSaved = (updated: Article) => {
    setArticleOverrides(prev => ({ ...prev, [updated.id]: updated }));
    queryClient.invalidateQueries({ queryKey: getGetArticlesQueryKey() });
  };

  const currentSnippet = snippets[currentSnippetIndex] ?? null;
  const selectedArticle = selectedArticleId != null
    ? { ...articles.find(a => a.id === selectedArticleId), ...articleOverrides[selectedArticleId] } as Article | undefined
    : undefined;

  const publicUrl = `${window.location.origin}${import.meta.env.BASE_URL}`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border px-6 py-4 flex items-center gap-4 bg-card/50 sticky top-0 z-20 backdrop-blur-md">
        <div className="flex items-center gap-2 flex-1">
          <Radio className="w-4 h-4 text-primary animate-pulse" />
          <span className="font-display font-bold text-lg text-foreground">News Admin</span>
        </div>
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Public Display
        </a>
        <button
          onClick={() => {
            sessionStorage.removeItem(AUTH_KEY);
            window.location.reload();
          }}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
        >
          <Lock className="w-3.5 h-3.5" /> Sign Out
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left sidebar: Article list ── */}
        <aside className="w-72 border-r border-border flex flex-col overflow-hidden bg-card/30">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Articles</p>
            <button
              onClick={() => setShowAddDrawer(true)}
              className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-all font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-primary/40" />
              </div>
            ) : articles.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No articles yet</p>
            ) : (
              articles.map(article => {
                const a = { ...article, ...articleOverrides[article.id] };
                const isSelected = a.id === selectedArticleId;
                return (
                  <div key={a.id} className={cn(
                    "group flex items-start gap-2 p-3 rounded-xl cursor-pointer transition-all border",
                    isSelected
                      ? "bg-primary/10 border-primary/30 text-white"
                      : "border-transparent hover:bg-white/5 text-white/60 hover:text-white/80"
                  )}>
                    <button onClick={() => handleSelectArticle(a as Article)} className="flex-1 min-w-0 text-left">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                        {a.source || 'Unknown'} · {new Date(a.publishedAt).toLocaleDateString()}
                      </p>
                      <p className="text-sm font-medium leading-snug line-clamp-2">{a.title}</p>
                      {isSelected && snippets.length > 0 && (
                        <p className="text-[10px] text-primary/60 mt-1">
                          {snippets.length} chapters · Chapter {currentSnippetIndex + 1} on air
                        </p>
                      )}
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); deleteMutation.mutate({ id: a.id }); }}
                      disabled={deleteMutation.isPending}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive transition-all shrink-0"
                      title="Delete article"
                    >
                      {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {!selectedArticle ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <p className="text-muted-foreground">Select an article from the left to start</p>
              <button onClick={() => setShowAddDrawer(true)}
                className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 text-primary text-sm hover:bg-primary/20 transition-all"
              >
                <Plus className="w-4 h-4" /> Add your first article
              </button>
            </div>
          ) : (
            <>
              {/* Article meta + playback controls */}
              <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                {/* Article metadata editor */}
                <ArticleMetaEditor article={selectedArticle} onSaved={handleArticleSaved} />

                <div className="border-t border-border pt-4">
                  {/* Playback controls */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handlePrev}
                      disabled={currentSnippetIndex === 0}
                      className="p-2.5 rounded-xl border border-border text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>

                    <div className="flex-1 text-center">
                      {isLoadingSnippets ? (
                        <Loader2 className="w-4 h-4 animate-spin mx-auto text-primary/40" />
                      ) : currentSnippet ? (
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">
                            Chapter {currentSnippetIndex + 1} of {snippets.length} · On Air
                          </p>
                          <p className="text-sm font-semibold text-white line-clamp-1">{currentSnippet.headline}</p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No chapters</p>
                      )}
                    </div>

                    <button
                      onClick={handleNext}
                      disabled={currentSnippetIndex >= snippets.length - 1}
                      className="p-2.5 rounded-xl border border-border text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>

                    {/* Auto-play toggle */}
                    <button
                      onClick={() => {
                        if (!autoPlay && selectedArticleId) {
                          // Starting: restart from chapter 1
                          stop();
                          prevIndexRef.current = -1;
                          updatePlayback(selectedArticleId, 0);
                        }
                        setAutoPlay(v => !v);
                      }}
                      title={autoPlay ? `Auto-advancing every ${AUTO_PLAY_SECONDS}s (or after audio ends)` : 'Auto-play off — click to enable'}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all",
                        autoPlay
                          ? "bg-green-500/20 border-green-500/40 text-green-400"
                          : "border-border text-white/50 hover:text-white hover:bg-white/5"
                      )}
                    >
                      {autoPlay ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      {autoPlay ? 'Auto' : 'Manual'}
                    </button>

                    {/* Voice toggle */}
                    <button
                      onClick={() => { setVoiceEnabled(v => !v); if (voiceEnabled) stop(); }}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all",
                        voiceEnabled
                          ? "bg-primary/20 border-primary/40 text-primary"
                          : "border-border text-white/50 hover:text-white hover:bg-white/5"
                      )}
                    >
                      {isVoiceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : voiceEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                      {voiceEnabled ? 'Voice On' : 'Voice Off'}
                    </button>

                    <a href={publicUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm text-white/50 hover:text-white hover:bg-white/5 transition-all"
                    >
                      <ExternalLink className="w-4 h-4" /> Preview Display
                    </a>
                  </div>
                </div>
              </div>

              {/* Chapter list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium px-1">
                    Chapters ({snippets.length})
                  </p>
                  <p className="text-[11px] text-muted-foreground/50">Click chapter to put on air · Click edit icon to modify text</p>
                </div>

                {isLoadingSnippets ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-primary/40" />
                  </div>
                ) : snippets.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    No chapters found for this article.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {snippets.map((snippet, i) => (
                      <SnippetRow
                        key={snippet.id}
                        snippet={snippet}
                        index={i}
                        totalChapters={snippets.length}
                        isOnAir={i === currentSnippetIndex}
                        onSelect={() => handleSelectChapter(i)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {/* Add Article Drawer */}
      <AnimatePresence>
        {showAddDrawer && (
          <AddArticleDrawer
            onClose={() => setShowAddDrawer(false)}
            onAdded={() => setShowAddDrawer(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
