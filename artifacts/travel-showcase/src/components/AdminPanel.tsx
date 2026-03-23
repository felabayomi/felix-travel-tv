import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { 
  X, Plus, Trash2, ArrowUp, ArrowDown, ExternalLink, 
  Settings2, Loader2, Image as ImageIcon, Eye, Pencil, Sparkles, XCircle
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
  slideCount: number;
}

export function AdminPanel({ goTo, slideCount }: AdminPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [hint, setHint] = useState('');
  const [editError, setEditError] = useState('');
  
  const queryClient = useQueryClient();
  const invalidateSlides = () => queryClient.invalidateQueries({ queryKey: getGetSlidesQueryKey() });

  const { data: slides = [], isLoading: isLoadingSlides } = useGetSlides();
  
  const createMutation = useCreateSlide({
    mutation: {
      onSuccess: () => {
        setNewUrl('');
        setAddError('');
        invalidateSlides().then(() => {
          setIsOpen(false);
          setTimeout(() => goTo(slideCount), 200);
        });
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

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 p-3 rounded-full bg-black/20 text-white/50 backdrop-blur-md",
          "hover:bg-black/50 hover:text-white transition-all duration-300 z-40 group",
          isOpen && "opacity-0 pointer-events-none"
        )}
        title="Open Admin Panel"
      >
        <Settings2 className="w-5 h-5 group-hover:rotate-90 transition-transform duration-700" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
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
                  onClick={() => setIsOpen(false)}
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
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Active Slides ({slides.length})
                </h3>
                
                {isLoadingSlides ? (
                  <div className="flex justify-center p-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : slides.length === 0 ? (
                  <div className="text-center p-8 border border-dashed border-border rounded-xl">
                    <p className="text-sm text-muted-foreground">No products added yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {slides.map((slide, index) => (
                      <div key={slide.id} className="group bg-background border border-border rounded-xl overflow-hidden hover:border-primary/40 transition-colors">

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
                      </div>
                    ))}
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
