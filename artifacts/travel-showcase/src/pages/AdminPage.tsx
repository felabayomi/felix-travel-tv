import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Edit3, Check, X,
  Mic, MicOff, Lock, Eye, EyeOff, ExternalLink, Radio,
  Loader2, FileText, Link, CalendarDays, ChevronDown, ChevronUp,
  Settings2, RotateCcw, Play, Pause, Clock, Globe, Archive, ArchiveRestore, Download
} from 'lucide-react';
import {
  useGetArticles, useGetArticleSnippets, useCreateArticle,
  useDeleteArticle, getGetArticlesQueryKey,
} from '@workspace/api-client-react';
import type { Article, Snippet } from '@workspace/api-client-react/src/generated/api.schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useVoiceReader } from '@/hooks/use-voice-reader';
import { cn } from '@/lib/utils';
import { exportArticleToMp4 } from '@/lib/exportArticleMp4';

const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN ?? '1234';
const AUTH_KEY = 'newsreader_admin_auth';
const SOURCE_KEY = 'newsreader_last_source';

// ─── Playback API helpers ──────────────────────────────────────────────────
async function setPlayback(articleId: number | null, snippetIndex: number) {
  await fetch('/api/playback', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemType: articleId ? 'article' : null, articleId, snippetIndex }),
  });
}

async function setVideoPlayback(videoId: number) {
  await fetch('/api/playback', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemType: 'video', videoId }),
  });
}

// ─── Video API helpers ─────────────────────────────────────────────────────
interface VideoItem {
  id: number;
  title: string;
  url: string;
  maxDurationSecs: number | null;
  loop: boolean;
  archived: boolean;
  sortOrder: number;
}

async function fetchVideos(): Promise<VideoItem[]> {
  const res = await fetch('/api/videos', { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function createVideo(data: { title: string; url: string; maxDurationSecs?: number | null; loop?: boolean }) {
  const res = await fetch('/api/videos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create video');
  return res.json() as Promise<VideoItem>;
}

async function archiveVideo(id: number, archived: boolean) {
  await fetch(`/api/videos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived }),
  });
}

async function deleteVideo(id: number) {
  await fetch(`/api/videos/${id}`, { method: 'DELETE' });
}

async function patchVideo(id: number, fields: Partial<Pick<VideoItem, 'title' | 'maxDurationSecs' | 'loop'>>) {
  const res = await fetch(`/api/videos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error('Failed to update video');
  return res.json() as Promise<VideoItem>;
}

async function setOnAirState(onAir: boolean) {
  await fetch('/api/playback', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ onAir }),
  });
}

// ─── Queue API helpers ─────────────────────────────────────────────────────
interface QueueItem {
  type: 'article' | 'video';
  articleId?: number | null;
  videoId?: number | null;
  title: string;
}

interface QueueState {
  items: QueueItem[];
  queueIndex: number;
  autoplayQueue: boolean;
  onAir: boolean;
}

async function fetchQueueState(): Promise<QueueState> {
  const res = await fetch('/api/playback/queue', { cache: 'no-store' });
  if (!res.ok) return { items: [], queueIndex: -1, autoplayQueue: false, onAir: false };
  return res.json();
}

async function apiAddToQueue(item: QueueItem): Promise<QueueItem[]> {
  const res = await fetch('/api/playback/queue/item', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error('Failed to add to queue');
  const data = await res.json();
  return data.items;
}

async function apiRemoveFromQueue(index: number): Promise<QueueItem[]> {
  const res = await fetch(`/api/playback/queue/item/${index}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to remove from queue');
  const data = await res.json();
  return data.items;
}

async function apiReorderQueue(items: QueueItem[]): Promise<void> {
  await fetch('/api/playback/queue', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
}

async function apiPlayQueueItem(index: number): Promise<void> {
  await fetch(`/api/playback/queue/play/${index}`, { method: 'POST' });
}

async function apiAdvanceQueue(): Promise<void> {
  await fetch('/api/playback/queue/advance', { method: 'POST' });
}

async function apiSetQueueAutoplay(autoplayQueue: boolean): Promise<void> {
  await fetch('/api/playback/queue/autoplay', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoplayQueue }),
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

async function archiveArticle(id: number, archived: boolean) {
  await fetch(`/api/articles/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived }),
  });
}

async function patchArticle(id: number, fields: { title?: string; source?: string; publishedAt?: string }) {
  const res = await fetch(`/api/articles/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error('Failed to save');
  return res.json();
}

// ─── Waiting Screen Config ────────────────────────────────────────────────
const WAITING_CONFIG_KEY = 'newsreader_waiting_config';

interface WaitingConfig {
  channelName: string;
  tagline: string;
  broadcastTime: string;
  topics: string[];
  websiteLabel: string;
  websiteUrl: string;
  socialLinks: Array<{ label: string; url: string }>;
  customTickerItems: string[];
  tickerSpeed: number;
  rotatingNames: Array<{ name: string; tagline: string }>;
  interludeImages: string[];
}

const EMPTY_CONFIG: WaitingConfig = {
  channelName: '',
  tagline: '',
  broadcastTime: '',
  topics: [],
  websiteLabel: '',
  websiteUrl: '',
  socialLinks: [],
  customTickerItems: [],
  tickerSpeed: 3,
  rotatingNames: [],
  interludeImages: [],
};

const PRESETS: Array<{ name: string; description: string; config: Partial<WaitingConfig> }> = [
  {
    name: 'Travel Channel',
    description: 'City Discoverer / global travel planner setup',
    config: {
      channelName: 'City Discoverer Live',
      tagline: 'Travel Planning • Deals • Tools • News',
      topics: ['Travel Industry Updates', 'Flight Deals of the Week', 'New Visa Rules', 'Travel Tech Tools — City Discoverer Companion, Itinerary Builder, LiveLoop, FanLore & more', 'City of the Day', 'Finance & Travel Costs'],
      websiteLabel: 'Book a session',
      websiteUrl: 'schedez.io',
      socialLinks: [
        { label: 'Twitch', url: 'twitch.tv/globaltravelplanner' },
        { label: 'Virtual Office', url: 'eacd.us' },
      ],
      customTickerItems: [
        'Book your next trip with City Discoverer Live',
        'New flight deals updated daily — book a session at schedez.io',
        'Subscribe for weekly travel tips, tools and destination guides',
      ],
      rotatingNames: [
        { name: 'The Travel Blueprint',  tagline: 'Smart planning for unforgettable trips' },
        { name: 'Plan Less Travel More', tagline: 'I handle the details. You enjoy the journey' },
        { name: 'Where To Next?',        tagline: "Tell me your dream destination — I'll make it happen" },
        { name: 'Done For You Travel',   tagline: 'I plan, price, and book everything for you' },
        { name: 'The Traveler Hub',      tagline: 'Travel planning for every type of traveler' },
        { name: 'Your Travel Advisor',   tagline: 'Your personal planner, booker, and travel expert' },
      ],
    },
  },
  {
    name: 'Finance News',
    description: 'Markets, investing & economics',
    config: {
      channelName: 'Finance Today Live',
      tagline: 'Markets • Investing • Economics',
      topics: ['Market Updates', 'Exchange Rates', 'Investment Tips', 'Economic News', 'Crypto Watch'],
      websiteLabel: '',
      websiteUrl: '',
      socialLinks: [],
      customTickerItems: [
        'Markets open at 09:30 ET',
        'Follow for daily market updates and analysis',
      ],
    },
  },
  {
    name: 'General News',
    description: 'All-purpose news broadcast',
    config: {
      channelName: 'News Reader',
      tagline: 'Live News Broadcast',
      topics: ['World News', 'Technology', 'Health & Science', 'Sports', 'Entertainment'],
      websiteLabel: '',
      websiteUrl: '',
      socialLinks: [],
      customTickerItems: [],
    },
  },
];

function WaitingScreenPanel() {
  const [config, setConfig] = useState<WaitingConfig>(() => {
    try {
      const stored = localStorage.getItem(WAITING_CONFIG_KEY);
      return stored ? { ...EMPTY_CONFIG, ...JSON.parse(stored) } : { ...EMPTY_CONFIG };
    } catch {
      return { ...EMPTY_CONFIG };
    }
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tickerSaving, setTickerSaving] = useState(false);
  const [tickerSaved, setTickerSaved] = useState(false);
  const [rotNamesSaving, setRotNamesSaving] = useState(false);
  const [rotNamesSaved, setRotNamesSaved] = useState(false);
  const [interludeSaving, setInterludeSaving] = useState(false);
  const [interludeSaved, setInterludeSaved] = useState(false);
  const [newRotatingName, setNewRotatingName] = useState('');
  const [newRotatingTagline, setNewRotatingTagline] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const [newSocialLabel, setNewSocialLabel] = useState('');
  const [newSocialUrl, setNewSocialUrl] = useState('');
  const [newTickerItem, setNewTickerItem] = useState('');
  const [newInterludeUrl, setNewInterludeUrl] = useState('');
  const [liveTickerItems, setLiveTickerItems] = useState<{ headline: string; caption: string; isCustom?: boolean }[]>([]);
  const [editingCustomIdx, setEditingCustomIdx] = useState<number | null>(null);
  const [editCustomText, setEditCustomText] = useState('');

  const update = <K extends keyof WaitingConfig>(key: K, value: WaitingConfig[K]) =>
    setConfig(prev => ({ ...prev, [key]: value }));

  const applyPreset = (preset: typeof PRESETS[0]) =>
    setConfig(prev => ({ ...prev, ...preset.config }));

  const pushToServer = (cfg: WaitingConfig) =>
    fetch('/api/waiting-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    }).catch(() => {});

  // On mount: pull server config first; if server has data, use it.
  // Only push local data to server if server is empty (e.g. fresh restart with no DB record yet).
  useEffect(() => {
    async function syncOnMount() {
      try {
        const res = await fetch('/api/waiting-config');
        if (res.ok) {
          const serverData: WaitingConfig = await res.json();
          const serverHasData = !!(serverData.channelName || serverData.topics.length > 0 || serverData.customTickerItems.length > 0);
          if (serverHasData) {
            const merged = { ...EMPTY_CONFIG, ...serverData };
            setConfig(merged);
            localStorage.setItem(WAITING_CONFIG_KEY, JSON.stringify(merged));
          } else {
            pushToServer(config);
          }
        }
      } catch {
        pushToServer(config);
      }
    }
    syncOnMount();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch live ticker items every 4s so the admin sees what's actually scrolling
  useEffect(() => {
    async function fetchLive() {
      try {
        const res = await fetch('/api/ticker', { cache: 'no-store' });
        if (res.ok) setLiveTickerItems(await res.json());
      } catch { /* ignore */ }
    }
    fetchLive();
    const id = setInterval(fetchLive, 4000);
    return () => clearInterval(id);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      localStorage.setItem(WAITING_CONFIG_KEY, JSON.stringify(config));
      await pushToServer(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleSaveTicker = async () => {
    setTickerSaving(true);
    try {
      localStorage.setItem(WAITING_CONFIG_KEY, JSON.stringify(config));
      await pushToServer(config);
      setTickerSaved(true);
      setTimeout(() => setTickerSaved(false), 2500);
    } catch { /* ignore */ }
    setTickerSaving(false);
  };

  const handleSaveRotatingNames = async () => {
    setRotNamesSaving(true);
    try {
      localStorage.setItem(WAITING_CONFIG_KEY, JSON.stringify(config));
      await pushToServer(config);
      setRotNamesSaved(true);
      setTimeout(() => setRotNamesSaved(false), 2500);
    } catch { /* ignore */ }
    setRotNamesSaving(false);
  };

  const handleSaveInterlude = async () => {
    setInterludeSaving(true);
    try {
      localStorage.setItem(WAITING_CONFIG_KEY, JSON.stringify(config));
      await pushToServer(config);
      setInterludeSaved(true);
      setTimeout(() => setInterludeSaved(false), 2500);
    } catch { /* ignore */ }
    setInterludeSaving(false);
  };

  const addTopic = () => {
    if (!newTopic.trim()) return;
    update('topics', [...config.topics, newTopic.trim()]);
    setNewTopic('');
  };

  const addSocialLink = () => {
    if (!newSocialLabel.trim() || !newSocialUrl.trim()) return;
    update('socialLinks', [...config.socialLinks, { label: newSocialLabel.trim(), url: newSocialUrl.trim() }]);
    setNewSocialLabel('');
    setNewSocialUrl('');
  };

  const addTickerItem = () => {
    if (!newTickerItem.trim()) return;
    update('customTickerItems', [...config.customTickerItems, newTickerItem.trim()]);
    setNewTickerItem('');
  };

  return (
    <div className="space-y-5">

      {/* Quick Presets */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium mb-3">Quick Presets</p>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map(preset => (
            <button
              key={preset.name}
              onClick={() => applyPreset(preset)}
              className="flex flex-col items-start gap-1 p-3 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
            >
              <span className="text-sm font-semibold text-white">{preset.name}</span>
              <span className="text-[11px] text-muted-foreground leading-tight">{preset.description}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/50 mt-2">Presets fill the fields below — you can then edit and save.</p>
      </div>

      {/* Channel Branding */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Channel Branding</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground mb-1.5 block uppercase tracking-widest">Channel Name</label>
            <input
              value={config.channelName}
              onChange={e => update('channelName', e.target.value)}
              placeholder="e.g. City Discoverer Live"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1.5 block uppercase tracking-widest">Tagline</label>
            <input
              value={config.tagline}
              onChange={e => update('tagline', e.target.value)}
              placeholder="e.g. Travel Planning • Deals • Tools"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
            />
          </div>
        </div>

        {/* Rotating Names */}
        <div>
          <label className="text-[11px] text-muted-foreground mb-2 block uppercase tracking-widest">
            Rotating Channel Names
            <span className="ml-2 normal-case text-muted-foreground/50">— auto-cycle on waiting screen</span>
          </label>
          {(config.rotatingNames ?? []).length > 0 && (
            <div className="space-y-1.5 mb-2">
              {(config.rotatingNames ?? []).map((entry, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-background border border-border">
                  <span className="text-[#c8102e] text-xs font-mono mt-0.5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{entry.name}</p>
                    {entry.tagline && (
                      <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">{entry.tagline}</p>
                    )}
                  </div>
                  <button
                    onClick={() => update('rotatingNames', (config.rotatingNames ?? []).filter((_, idx) => idx !== i))}
                    className="text-muted-foreground hover:text-destructive transition-colors mt-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <input
              value={newRotatingName}
              onChange={e => setNewRotatingName(e.target.value)}
              placeholder="Channel name (e.g. The Travel Blueprint)"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
            />
            <div className="flex gap-2">
              <input
                value={newRotatingTagline}
                onChange={e => setNewRotatingTagline(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newRotatingName.trim()) {
                    update('rotatingNames', [...(config.rotatingNames ?? []), { name: newRotatingName.trim(), tagline: newRotatingTagline.trim() }]);
                    setNewRotatingName('');
                    setNewRotatingTagline('');
                  }
                }}
                placeholder="Tagline (optional)"
                className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
              />
              <button
                onClick={() => {
                  if (newRotatingName.trim()) {
                    update('rotatingNames', [...(config.rotatingNames ?? []), { name: newRotatingName.trim(), tagline: newRotatingTagline.trim() }]);
                    setNewRotatingName('');
                    setNewRotatingTagline('');
                  }
                }}
                className="px-3 py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-all text-xs font-medium"
              >
                Add
              </button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground/50 mt-1.5">
            Each entry shows a big name + tagline on the waiting screen. They rotate every 4.5 s.
          </p>
          <div className="flex justify-end pt-2 border-t border-border/40 mt-2">
            <button
              onClick={handleSaveRotatingNames}
              disabled={rotNamesSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all"
              style={{
                background: rotNamesSaved ? '#16a34a' : '#c8102e',
                color: '#fff',
                opacity: rotNamesSaving ? 0.6 : 1,
              }}
            >
              {rotNamesSaving ? 'Saving…' : rotNamesSaved ? '✓ Saved to Server' : 'Save Rotating Names'}
            </button>
          </div>
        </div>
      </div>

      {/* Broadcast Countdown */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Broadcast Countdown</p>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1.5 block uppercase tracking-widest">Scheduled Start Time (optional)</label>
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={config.broadcastTime}
              onChange={e => update('broadcastTime', e.target.value)}
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/60"
            />
            {config.broadcastTime && (
              <button
                onClick={() => update('broadcastTime', '')}
                className="px-3 py-2 rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-all text-xs"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/50 mt-1.5">Viewers see a live countdown timer on the waiting screen.</p>
        </div>
      </div>

      {/* Today's Topics */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Today's Topics</p>
        {config.topics.length > 0 && (
          <div className="space-y-1.5">
            {config.topics.map((topic, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border">
                <span className="text-[#c8102e] text-xs">•</span>
                <span className="text-sm text-white flex-1">{topic}</span>
                <button
                  onClick={() => update('topics', config.topics.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={newTopic}
            onChange={e => setNewTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTopic()}
            placeholder="Add a topic... (Enter to add)"
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
          />
          <button
            onClick={addTopic}
            disabled={!newTopic.trim()}
            className="px-3 py-2 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-40 transition-all"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Website & Booking */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Website & Booking</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-muted-foreground mb-1.5 block uppercase tracking-widest">Call-to-action label</label>
            <input
              value={config.websiteLabel}
              onChange={e => update('websiteLabel', e.target.value)}
              placeholder="e.g. Book a session"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1.5 block uppercase tracking-widest">URL</label>
            <input
              value={config.websiteUrl}
              onChange={e => update('websiteUrl', e.target.value)}
              placeholder="e.g. globaltravelplanner.com"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
            />
          </div>
        </div>
      </div>

      {/* Social Links */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Social Links</p>
        {config.socialLinks.length > 0 && (
          <div className="space-y-1.5">
            {config.socialLinks.map((link, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border">
                <span className="text-xs text-muted-foreground w-16 shrink-0 truncate font-medium">{link.label}</span>
                <span className="text-sm text-white/70 flex-1 truncate">{link.url}</span>
                <button
                  onClick={() => update('socialLinks', config.socialLinks.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={newSocialLabel}
            onChange={e => setNewSocialLabel(e.target.value)}
            placeholder="Platform"
            className="w-24 bg-background border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
          />
          <input
            value={newSocialUrl}
            onChange={e => setNewSocialUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addSocialLink()}
            placeholder="URL or handle"
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
          />
          <button
            onClick={addSocialLink}
            disabled={!newSocialLabel.trim() || !newSocialUrl.trim()}
            className="px-3 py-2 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-40 transition-all"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Ticker Settings */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">News Ticker</p>

        {/* Live ticker contents list */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground/50 uppercase tracking-widest">All Items Currently Scrolling</p>
            <span className="text-[10px] text-muted-foreground/40">{liveTickerItems.length} item{liveTickerItems.length !== 1 ? 's' : ''}</span>
          </div>

          {liveTickerItems.length === 0 ? (
            <div className="px-3 py-4 rounded-lg bg-background border border-border text-center text-[12px] text-muted-foreground/40">
              No items in ticker yet
            </div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
              {liveTickerItems.map((item, i) => {
                if (item.isCustom) {
                  // Find index in config.customTickerItems
                  const customIdx = config.customTickerItems.indexOf(item.headline);
                  const isEditing = editingCustomIdx === customIdx && customIdx !== -1;
                  return (
                    <div key={`custom-${i}`} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-background border border-border">
                      <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase"
                        style={{ background: 'rgba(200,16,46,0.15)', color: '#c8102e', border: '1px solid rgba(200,16,46,0.25)' }}>
                        CUSTOM
                      </span>
                      {isEditing ? (
                        <div className="flex-1 flex gap-1.5">
                          <input
                            autoFocus
                            value={editCustomText}
                            onChange={e => setEditCustomText(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                const updated = [...config.customTickerItems];
                                updated[customIdx] = editCustomText.trim() || item.headline;
                                update('customTickerItems', updated);
                                setEditingCustomIdx(null);
                              }
                              if (e.key === 'Escape') setEditingCustomIdx(null);
                            }}
                            className="flex-1 bg-background border border-primary/40 rounded px-2 py-0.5 text-sm text-white focus:outline-none"
                          />
                          <button
                            onClick={() => {
                              const updated = [...config.customTickerItems];
                              updated[customIdx] = editCustomText.trim() || item.headline;
                              update('customTickerItems', updated);
                              setEditingCustomIdx(null);
                            }}
                            className="text-green-400 hover:text-green-300 transition-colors shrink-0"
                          ><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setEditingCustomIdx(null)} className="text-muted-foreground hover:text-white transition-colors shrink-0">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm text-white/80 flex-1 leading-snug">{item.headline}</span>
                          <button
                            onClick={() => { setEditingCustomIdx(customIdx); setEditCustomText(item.headline); }}
                            className="text-muted-foreground hover:text-white transition-colors shrink-0"
                          ><Edit3 className="w-3.5 h-3.5" /></button>
                          <button
                            onClick={() => update('customTickerItems', config.customTickerItems.filter((_, idx) => idx !== customIdx))}
                            className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          ><X className="w-3.5 h-3.5" /></button>
                        </>
                      )}
                    </div>
                  );
                } else {
                  return (
                    <div key={`article-${i}`} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-background border border-border opacity-70">
                      <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase"
                        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.1)' }}>
                        ARTICLE
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/60 leading-snug truncate">{item.headline}</p>
                        {item.caption && <p className="text-[11px] text-muted-foreground/40 truncate mt-0.5">{item.caption}</p>}
                      </div>
                    </div>
                  );
                }
              })}
            </div>
          )}
        </div>

        {/* Add custom message */}
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground/50">Add Custom Message</p>
          <div className="flex gap-2">
            <input
              value={newTickerItem}
              onChange={e => setNewTickerItem(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTickerItem()}
              placeholder="Type a message and press Enter..."
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
            />
            <button
              onClick={addTickerItem}
              disabled={!newTickerItem.trim()}
              className="px-3 py-2 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-40 transition-all"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Speed control */}
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground/50">Scroll Speed</p>
          <div className="flex gap-1.5">
            {[
              { label: 'Slowest', value: 1 },
              { label: 'Slow', value: 2 },
              { label: 'Normal', value: 3 },
              { label: 'Fast', value: 4 },
              { label: 'Fastest', value: 5 },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => update('tickerSpeed', opt.value)}
                className="flex-1 py-1.5 rounded-md text-[11px] font-medium tracking-wide transition-all"
                style={{
                  background: config.tickerSpeed === opt.value ? '#c8102e' : 'rgba(255,255,255,0.06)',
                  color: config.tickerSpeed === opt.value ? '#fff' : 'rgba(255,255,255,0.45)',
                  border: config.tickerSpeed === opt.value ? '1px solid #c8102e' : '1px solid rgba(255,255,255,0.08)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Ticker Save button */}
        <div className="flex justify-end pt-1 border-t border-border/40">
          <button
            onClick={handleSaveTicker}
            disabled={tickerSaving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: tickerSaved ? 'rgba(34,197,94,0.15)' : 'rgba(200,16,46,0.15)',
              color: tickerSaved ? '#22c55e' : '#c8102e',
              border: tickerSaved ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(200,16,46,0.3)',
            }}
          >
            {tickerSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : tickerSaved ? <Check className="w-3.5 h-3.5" /> : null}
            {tickerSaved ? 'Ticker Saved!' : 'Save Ticker Settings'}
          </button>
        </div>
      </div>

      {/* Interlude Images */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Interlude Images</p>
          <p className="text-[11px] text-muted-foreground/50 mt-1">Shown as full-screen still images between articles during queue autoplay — 30 seconds each, picked at random.</p>
        </div>

        {(config.interludeImages ?? []).length > 0 && (
          <div className="space-y-1.5">
            {(config.interludeImages ?? []).map((url, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border">
                <span className="text-[#c8102e] text-xs font-mono shrink-0">{i + 1}</span>
                <span className="flex-1 text-xs text-white/70 truncate font-mono">{url}</span>
                <button
                  onClick={() => update('interludeImages', (config.interludeImages ?? []).filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={newInterludeUrl}
            onChange={e => setNewInterludeUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newInterludeUrl.trim()) {
                update('interludeImages', [...(config.interludeImages ?? []), newInterludeUrl.trim()]);
                setNewInterludeUrl('');
              }
            }}
            placeholder="https://example.com/travel-deal.jpg"
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60"
          />
          <button
            onClick={() => {
              if (!newInterludeUrl.trim()) return;
              update('interludeImages', [...(config.interludeImages ?? []), newInterludeUrl.trim()]);
              setNewInterludeUrl('');
            }}
            disabled={!newInterludeUrl.trim()}
            className="px-3 py-2 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-40 transition-all"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex justify-end pt-1 border-t border-border/40">
          <button
            onClick={handleSaveInterlude}
            disabled={interludeSaving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: interludeSaved ? 'rgba(34,197,94,0.15)' : 'rgba(200,16,46,0.15)',
              color: interludeSaved ? '#22c55e' : '#c8102e',
              border: interludeSaved ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(200,16,46,0.3)',
            }}
          >
            {interludeSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : interludeSaved ? <Check className="w-3.5 h-3.5" /> : null}
            {interludeSaved ? 'Saved!' : 'Save Interlude Images'}
          </button>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end pb-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-50 transition-all"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
          {saved ? 'Saved!' : 'Save Waiting Screen'}
        </button>
      </div>
    </div>
  );
}

// ─── PIN Gate ─────────────────────────────────────────────────────────────
function PinGate({ onAuth }: { onAuth: () => void }) {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === ADMIN_PIN) {
      if (remember) {
        localStorage.setItem(AUTH_KEY, 'true');
      } else {
        sessionStorage.setItem(AUTH_KEY, 'true');
      }
      onAuth();
    } else {
      setError('Incorrect access code');
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
          <p className="text-xs text-muted-foreground text-center">Enter your access code to continue</p>
        </div>
        <div className="space-y-3">
          <div className="relative">
            <input
              autoFocus type={showPin ? 'text' : 'password'}
              placeholder="Enter access code" value={pin}
              onChange={e => { setPin(e.target.value); setError(''); }}
              className="w-full bg-background border border-border rounded-xl px-4 pr-11 py-3 text-center text-2xl tracking-widest font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
            />
            <button type="button" onClick={() => setShowPin(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              title={showPin ? 'Hide code' : 'Show code'}
            >
              {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {error && <p className="text-xs text-destructive text-center">{error}</p>}
          <label className="flex items-center gap-2.5 cursor-pointer select-none group">
            <div
              onClick={() => setRemember(v => !v)}
              className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                remember ? 'bg-primary border-primary' : 'border-border bg-background group-hover:border-primary/50'
              }`}
            >
              {remember && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
            </div>
            <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
              Keep me signed in
            </span>
          </label>
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
function toDateInput(iso: string) {
  // Convert ISO string to YYYY-MM-DD for <input type="date">
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return ''; }
}

function ArticleMetaEditor({ article, onSaved }: { article: Article; onSaved: (a: Article) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(article.title);
  const [source, setSource] = useState(article.source ?? '');
  const [date, setDate] = useState(() => toDateInput(article.publishedAt));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await patchArticle(article.id, {
        title,
        source,
        publishedAt: date ? new Date(date).toISOString() : undefined,
      });
      onSaved(updated);
      setEditing(false);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleCancel = () => {
    setTitle(article.title);
    setSource(article.source ?? '');
    setDate(toDateInput(article.publishedAt));
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">
            {source || 'No source'} · {date || '—'}
          </p>
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
        placeholder="Article title"
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-all font-semibold"
      />
      <div className="grid grid-cols-2 gap-2">
        <input value={source} onChange={e => setSource(e.target.value)}
          placeholder="Source name"
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-all"
        />
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary transition-all text-foreground"
        />
      </div>
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
        </button>
        <button onClick={handleCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-white/5"
        >
          <X className="w-3 h-3" /> Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Sidebar inline editors ────────────────────────────────────────────────
function SidebarArticleEditor({ article, onClose, onSaved }: {
  article: Article;
  onClose: () => void;
  onSaved: (a: Article) => void;
}) {
  const [title, setTitle] = useState(article.title);
  const [source, setSource] = useState(article.source ?? '');
  const [date, setDate] = useState(() => toDateInput(article.publishedAt));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await patchArticle(article.id, {
        title,
        source,
        publishedAt: date ? new Date(date).toISOString() : undefined,
      });
      onSaved(updated);
      onClose();
    } catch { /* ignore */ }
    setSaving(false);
  };

  return (
    <div className="px-3 pb-3 space-y-2 border-t border-primary/20 pt-2.5">
      <input value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Article title"
        className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary transition-all"
      />
      <div className="grid grid-cols-2 gap-2">
        <input value={source} onChange={e => setSource(e.target.value)}
          placeholder="Source"
          className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary transition-all"
        />
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary transition-all text-foreground"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/80 disabled:opacity-50 transition-all"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-white hover:border-white/30 transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SidebarVideoEditor({ video, onClose, onSaved }: {
  video: VideoItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(video.title);
  const [maxMins, setMaxMins] = useState(() => video.maxDurationSecs ? String(Math.floor(video.maxDurationSecs / 60)) : '');
  const [maxSecs, setMaxSecs] = useState(() => video.maxDurationSecs ? String(video.maxDurationSecs % 60) : '');
  const [loop, setLoop] = useState(video.loop);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const mins = parseInt(maxMins || '0', 10) || 0;
      const secs = parseInt(maxSecs || '0', 10) || 0;
      const maxDurationSecs = mins * 60 + secs || null;
      await patchVideo(video.id, { title, maxDurationSecs: maxDurationSecs ?? undefined, loop });
      onSaved();
      onClose();
    } catch { /* ignore */ }
    setSaving(false);
  };

  return (
    <div className="px-3 pb-3 space-y-2 border-t border-primary/20 pt-2.5">
      <input value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Video title"
        className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary transition-all"
      />
      <div className="flex gap-2 items-center">
        <span className="text-xs text-muted-foreground shrink-0">Max duration</span>
        <input value={maxMins} onChange={e => setMaxMins(e.target.value)}
          placeholder="0" type="number" min="0"
          className="w-14 bg-background border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-primary transition-all"
        />
        <span className="text-xs text-muted-foreground">m</span>
        <input value={maxSecs} onChange={e => setMaxSecs(e.target.value)}
          placeholder="0" type="number" min="0" max="59"
          className="w-14 bg-background border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-primary transition-all"
        />
        <span className="text-xs text-muted-foreground">s</span>
      </div>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)}
          className="accent-primary w-3.5 h-3.5"
        />
        <span className="text-xs text-muted-foreground">Loop video</span>
      </label>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/80 disabled:opacity-50 transition-all"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-white hover:border-white/30 transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Add Video Drawer ──────────────────────────────────────────────────────
function AddVideoDrawer({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [maxMins, setMaxMins] = useState('');
  const [maxSecs, setMaxSecs] = useState('');
  const [loop, setLoop] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !url.trim()) return;
    setSaving(true);
    setError('');
    try {
      const mins = parseInt(maxMins || '0', 10) || 0;
      const secs = parseInt(maxSecs || '0', 10) || 0;
      const totalSecs = mins * 60 + secs;
      await createVideo({
        title: title.trim(),
        url: url.trim(),
        maxDurationSecs: totalSecs > 0 ? totalSecs : null,
        loop,
      });
      onAdded();
    } catch (err: any) {
      setError(err?.message || 'Failed to add video');
    }
    setSaving(false);
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
            <h2 className="text-lg font-display font-bold">Add Video</h2>
            <p className="text-xs text-muted-foreground mt-0.5">YouTube, Vimeo, or direct video URL</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileText className="w-3.5 h-3.5" /> Title <span className="text-destructive">*</span>
            </label>
            <input
              type="text" required placeholder="e.g. Destination Highlight: Japan"
              value={title} onChange={e => setTitle(e.target.value)} disabled={saving}
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-all placeholder:text-muted-foreground/40"
            />
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Link className="w-3.5 h-3.5" /> Video URL <span className="text-destructive">*</span>
            </label>
            <input
              type="url" required placeholder="https://youtube.com/watch?v=..."
              value={url} onChange={e => setUrl(e.target.value)} disabled={saving}
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-all placeholder:text-muted-foreground/40"
            />
            <p className="text-[11px] text-muted-foreground/50">Supports YouTube, Vimeo, and direct .mp4/.webm URLs</p>
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Clock className="w-3.5 h-3.5" /> Max play time (optional)
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-1.5">
                <input
                  type="number" min="0" max="999" placeholder="0"
                  value={maxMins} onChange={e => setMaxMins(e.target.value)} disabled={saving}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-all text-center"
                />
                <span className="text-xs text-muted-foreground shrink-0">min</span>
              </div>
              <div className="flex-1 flex items-center gap-1.5">
                <input
                  type="number" min="0" max="59" placeholder="0"
                  value={maxSecs} onChange={e => setMaxSecs(e.target.value)} disabled={saving}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary transition-all text-center"
                />
                <span className="text-xs text-muted-foreground shrink-0">sec</span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground/50">Leave at 0 for no limit. For loop videos, this sets when the display moves on.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setLoop(v => !v)}
              className={cn(
                "w-10 h-6 rounded-full relative transition-colors",
                loop ? "bg-primary" : "bg-white/20"
              )}
            >
              <span className={cn(
                "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all",
                loop ? "left-[18px]" : "left-0.5"
              )} />
            </button>
            <span className="text-sm font-medium">Loop video</span>
            <span className="text-xs text-muted-foreground">(repeats until max time is reached)</span>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button
            type="submit" disabled={saving || !title.trim() || !url.trim()}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Adding…' : 'Add Video to Queue'}
          </button>
        </form>
      </motion.div>
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
  const [showAddVideoDrawer, setShowAddVideoDrawer] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'articles' | 'videos'>('articles');
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [onAir, setOnAir] = useState(false);
  const [mainTab, setMainTab] = useState<'broadcast' | 'waiting' | 'archive'>('broadcast');
  const AUTO_PLAY_SECONDS = 15;
  const [articleOverrides, setArticleOverrides] = useState<Record<number, Partial<Article>>>({});
  const [articleOrder, setArticleOrder] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem('newsreader_article_order') ?? '[]'); } catch { return []; }
  });

  // ── Inline sidebar editing ─────────────────────────────────────────────────
  const [editingArticleId, setEditingArticleId] = useState<number | null>(null);
  const [editingVideoId, setEditingVideoId] = useState<number | null>(null);
  const [exportingArticleId, setExportingArticleId] = useState<number | null>(null);
  const [exportProgress, setExportProgress] = useState(0);

  // ── Broadcast Queue state ──────────────────────────────────────────────────
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueAutoplay, setQueueAutoplay] = useState(false);
  const [playingQueueIndex, setPlayingQueueIndex] = useState(-1);

  const loadQueue = useCallback(async () => {
    const state = await fetchQueueState();
    setQueue(state.items);
    setPlayingQueueIndex(state.queueIndex);
    setQueueAutoplay(state.autoplayQueue);
    setOnAir(state.onAir);
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  // Poll queue state every 2 s so admin stays in sync with public display advances
  useEffect(() => {
    const id = setInterval(loadQueue, 2000);
    return () => clearInterval(id);
  }, [loadQueue]);

  // Derived: which article / video is currently playing from the queue
  const playingQueueItem = queue[playingQueueIndex] ?? null;
  const playingArticleId = playingQueueItem?.type === 'article' ? (playingQueueItem.articleId ?? null) : null;
  const playingVideoId   = playingQueueItem?.type === 'video'   ? (playingQueueItem.videoId   ?? null) : null;

  // Keep order in sync as articles load or change
  useEffect(() => {
    if (articles.length === 0) return;
    const ids = articles.map(a => a.id);
    setArticleOrder(prev => {
      const existing = prev.filter(id => ids.includes(id));
      const newIds = ids.filter(id => !prev.includes(id));
      const merged = [...existing, ...newIds];
      localStorage.setItem('newsreader_article_order', JSON.stringify(merged));
      return merged;
    });
  }, [articles]);

  const sortedArticles = [...articles].sort((a, b) => {
    const ai = articleOrder.indexOf(a.id);
    const bi = articleOrder.indexOf(b.id);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  const activeArticles = sortedArticles.filter(a => !a.archived);
  const archivedArticles = articles.filter(a => a.archived).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  const moveArticle = (id: number, dir: -1 | 1) => {
    setArticleOrder(prev => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const updated = [...prev];
      [updated[idx], updated[next]] = [updated[next], updated[idx]];
      localStorage.setItem('newsreader_article_order', JSON.stringify(updated));
      return updated;
    });
  };

  // Snippets for the currently playing article from the queue
  const { data: snippets = [], isLoading: isLoadingSnippets } = useGetArticleSnippets(
    playingArticleId ?? 0,
    { query: { enabled: playingArticleId !== null } }
  );

  const deleteMutation = useDeleteArticle({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetArticlesQueryKey() });
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

  const handleNext = useCallback(async () => {
    if (!playingArticleId || snippets.length === 0) return;
    const next = currentSnippetIndex + 1;
    if (next >= snippets.length) {
      // Last chapter done — advance queue if autoplay is on
      if (queueAutoplay) {
        const hasNextItem = playingQueueIndex < queue.length - 1;
        const cfg = await fetch('/api/waiting-config').then(r => r.json()).catch(() => null);
        const interludeImages: string[] = cfg?.interludeImages ?? [];
        if (hasNextItem && interludeImages.length > 0) {
          const img = interludeImages[Math.floor(Math.random() * interludeImages.length)];
          await fetch('/api/playback/queue/interlude', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: img }),
          });
          // Public display handles 30s countdown then calls /queue/advance automatically
        } else {
          await apiAdvanceQueue();
        }
        await loadQueue();
      }
      return;
    }
    updatePlayback(playingArticleId, next);
  }, [playingArticleId, snippets.length, currentSnippetIndex, updatePlayback, queueAutoplay, loadQueue, playingQueueIndex, queue.length]);

  const handlePrev = useCallback(() => {
    if (!playingArticleId || snippets.length === 0) return;
    const prev = Math.max(currentSnippetIndex - 1, 0);
    updatePlayback(playingArticleId, prev);
  }, [playingArticleId, snippets.length, currentSnippetIndex, updatePlayback]);

  // Always-current ref so timer/voice callbacks never hold a stale handleNext closure
  const handleNextRef = useRef(handleNext);
  useEffect(() => { handleNextRef.current = handleNext; }, [handleNext]);

  useEffect(() => {
    if (!voiceEnabled || !snippets[currentSnippetIndex]) return;
    if (prevIndexRef.current === currentSnippetIndex) return;
    prevIndexRef.current = currentSnippetIndex;
    const chapterAutoplay = autoPlay || queueAutoplay;
    speak(
      snippets[currentSnippetIndex].id,
      chapterAutoplay ? () => handleNextRef.current() : undefined,
    );
  // handleNext intentionally omitted — we use the ref to avoid restarting on every index change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSnippetIndex, snippets, voiceEnabled, speak, autoPlay, queueAutoplay]);

  // Timer-based auto-advance when voice is off
  // handleNext intentionally omitted from deps — ref keeps it fresh without restarting the timer
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const chapterAutoplay = autoPlay || queueAutoplay;
    if (!chapterAutoplay || voiceEnabled || !playingArticleId || snippets.length === 0) return;
    if (currentSnippetIndex >= snippets.length - 1) {
      // On last chapter — show interlude or advance queue after delay
      if (queueAutoplay) {
        const timer = setTimeout(async () => {
          const hasNextItem = playingQueueIndex < queue.length - 1;
          const cfg = await fetch('/api/waiting-config').then(r => r.json()).catch(() => null);
          const interludeImages: string[] = cfg?.interludeImages ?? [];
          if (hasNextItem && interludeImages.length > 0) {
            const img = interludeImages[Math.floor(Math.random() * interludeImages.length)];
            await fetch('/api/playback/queue/interlude', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl: img }),
            });
          } else {
            await apiAdvanceQueue();
          }
          await loadQueue();
        }, AUTO_PLAY_SECONDS * 1000);
        return () => clearTimeout(timer);
      }
      return;
    }
    const timer = setTimeout(() => handleNextRef.current(), AUTO_PLAY_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [autoPlay, queueAutoplay, voiceEnabled, currentSnippetIndex, snippets.length, playingArticleId, loadQueue, playingQueueIndex, queue.length]);

  // Reset snippet index when the playing article changes
  useEffect(() => {
    setCurrentSnippetIndex(0);
    prevIndexRef.current = -1;
  }, [playingArticleId]);

  const handleSelectChapter = (index: number) => {
    if (!playingArticleId) return;
    updatePlayback(playingArticleId, index);
  };

  const handleArticleSaved = (updated: Article) => {
    setArticleOverrides(prev => ({ ...prev, [updated.id]: updated }));
    queryClient.invalidateQueries({ queryKey: getGetArticlesQueryKey() });
  };

  const currentSnippet = snippets[currentSnippetIndex] ?? null;
  const selectedArticle = selectedArticleId != null
    ? { ...articles.find(a => a.id === selectedArticleId), ...articleOverrides[selectedArticleId] } as Article | undefined
    : undefined;
  void selectedArticle; // used in meta editor when shown

  const reloadVideos = useCallback(() => {
    fetchVideos().then(vs => setVideos(vs.filter(v => !v.archived)));
  }, []);

  useEffect(() => { reloadVideos(); }, [reloadVideos]);

  const activeVideos = videos.filter(v => !v.archived);

  const publicUrl = `${window.location.origin}${import.meta.env.BASE_URL}`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border px-6 py-4 flex items-center gap-4 bg-card/50 sticky top-0 z-20 backdrop-blur-md">
        <div className="flex items-center gap-2 flex-1">
          <Radio className="w-4 h-4 text-primary animate-pulse" />
          <span className="font-display font-bold text-lg text-foreground">News Admin</span>
        </div>
        {/* On Air toggle */}
        <button
          onClick={() => {
            const next = !onAir;
            setOnAir(next);
            setOnAirState(next).catch(() => {});
          }}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold tracking-widest uppercase transition-all",
            onAir
              ? "bg-red-600 border-red-500 text-white shadow-lg shadow-red-600/30 animate-pulse"
              : "border-border text-muted-foreground hover:text-white hover:bg-white/5"
          )}
        >
          <Radio className="w-3.5 h-3.5" />
          {onAir ? 'On Air' : 'Off Air'}
        </button>

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
            localStorage.removeItem(AUTH_KEY);
            window.location.reload();
          }}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
        >
          <Lock className="w-3.5 h-3.5" /> Sign Out
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left sidebar: Articles + Videos ── */}
        <aside className="w-72 border-r border-border flex flex-col overflow-hidden bg-card/30">
          {/* Tab header */}
          <div className="border-b border-border">
            <div className="flex">
              <button
                onClick={() => setSidebarTab('articles')}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-xs font-semibold uppercase tracking-widest border-b-2 transition-all",
                  sidebarTab === 'articles' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-white"
                )}
              >
                <FileText className="w-3.5 h-3.5" /> Articles
              </button>
              <button
                onClick={() => setSidebarTab('videos')}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-xs font-semibold uppercase tracking-widest border-b-2 transition-all",
                  sidebarTab === 'videos' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-white"
                )}
              >
                <Play className="w-3.5 h-3.5" /> Videos
                {activeVideos.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-primary/20 text-primary">{activeVideos.length}</span>
                )}
              </button>
            </div>
            <div className="px-3 py-2 flex justify-end">
              {sidebarTab === 'articles' ? (
                <button
                  onClick={() => setShowAddDrawer(true)}
                  className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-all font-medium"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Article
                </button>
              ) : (
                <button
                  onClick={() => setShowAddVideoDrawer(true)}
                  className="flex items-center gap-1.5 text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-all font-medium"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Video
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {sidebarTab === 'videos' ? (
            activeVideos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <Play className="w-8 h-8 text-muted-foreground/30 mb-3" />
                <p className="text-xs text-muted-foreground">No videos yet</p>
                <p className="text-[11px] text-muted-foreground/50 mt-1">Add a YouTube, Vimeo, or direct video URL</p>
              </div>
            ) : (
              activeVideos.map(video => {
                const isPlaying = video.id === playingVideoId && onAir;
                const isEditingV = editingVideoId === video.id;
                return (
                  <div key={video.id} className={cn(
                    "rounded-xl border transition-all",
                    isEditingV
                      ? "border-primary/40 bg-primary/5"
                      : isPlaying
                        ? "bg-primary/20 border-primary/50"
                        : "border-transparent hover:bg-white/5"
                  )}>
                    <div className={cn("group flex items-start gap-1.5 p-3 transition-all",
                      isPlaying || isEditingV ? "text-white" : "text-white/60 hover:text-white/80"
                    )}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {isPlaying
                            ? <span className="flex items-center gap-1 text-[10px] font-bold text-primary shrink-0 uppercase tracking-wider">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />LIVE
                              </span>
                            : <Play className="w-3 h-3 text-primary/60 shrink-0" />
                          }
                          <p className="text-sm font-medium leading-snug line-clamp-2">{video.title}</p>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {video.maxDurationSecs
                            ? `Max ${Math.floor(video.maxDurationSecs / 60)}m ${video.maxDurationSecs % 60}s`
                            : 'No time limit'
                          }
                          {video.loop ? ' · Loop' : ''}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity">
                        <button
                          onClick={async e => {
                            e.stopPropagation();
                            const newItems = await apiAddToQueue({ type: 'video', videoId: video.id, title: video.title });
                            setQueue(newItems);
                            setMainTab('broadcast');
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-primary transition-all"
                          title="Add to queue"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setEditingVideoId(prev => prev === video.id ? null : video.id);
                          }}
                          className={cn(
                            "p-1 rounded transition-all",
                            isEditingV ? "text-primary" : "text-muted-foreground hover:text-white"
                          )}
                          title="Edit video"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            archiveVideo(video.id, true).then(() => { reloadVideos(); });
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-amber-400 transition-all"
                          title="Archive video"
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            deleteVideo(video.id).then(() => { reloadVideos(); });
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-destructive transition-all"
                          title="Delete video"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {isEditingV && (
                      <SidebarVideoEditor
                        video={video}
                        onClose={() => setEditingVideoId(null)}
                        onSaved={() => reloadVideos()}
                      />
                    )}
                  </div>
                );
              })
            )
          ) : (<>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-primary/40" />
              </div>
            ) : activeArticles.length === 0 && archivedArticles.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No articles yet</p>
            ) : activeArticles.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                All articles archived.{' '}
                <button onClick={() => setMainTab('archive')} className="text-primary underline underline-offset-2">View archive</button>
              </p>
            ) : (
              activeArticles.map((article, listIdx) => {
                const a = { ...article, ...articleOverrides[article.id] };
                const isSelected = a.id === selectedArticleId;
                const isEditing = editingArticleId === a.id;
                return (
                  <div key={a.id} className={cn(
                    "rounded-xl border transition-all",
                    isEditing
                      ? "border-primary/40 bg-primary/5"
                      : isSelected
                        ? "bg-primary/10 border-primary/30"
                        : "border-transparent hover:bg-white/5"
                  )}>
                    {/* Row */}
                    <div className={cn("group flex items-start gap-1.5 p-3 cursor-pointer transition-all",
                      isSelected || isEditing ? "text-white" : "text-white/60 hover:text-white/80"
                    )}>
                      {/* Reorder buttons */}
                      <div className="flex flex-col gap-0.5 pt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={e => { e.stopPropagation(); moveArticle(a.id, -1); }}
                          disabled={listIdx === 0}
                          className="p-0.5 rounded text-muted-foreground hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                          title="Move up"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); moveArticle(a.id, 1); }}
                          disabled={listIdx === activeArticles.length - 1}
                          className="p-0.5 rounded text-muted-foreground hover:text-white disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                          title="Move down"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <button onClick={() => setSelectedArticleId(a.id)} className="flex-1 min-w-0 text-left">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5">
                          {a.source || 'Unknown'} · {new Date(a.publishedAt).toLocaleDateString()}
                        </p>
                        <p className="text-sm font-medium leading-snug line-clamp-2">{a.title}</p>
                      </button>
                      <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity">
                        <button
                          onClick={async e => {
                            e.stopPropagation();
                            const newItems = await apiAddToQueue({ type: 'article', articleId: a.id, title: a.title });
                            setQueue(newItems);
                            setMainTab('broadcast');
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-primary transition-all"
                          title="Add to queue"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setEditingArticleId(prev => prev === a.id ? null : a.id);
                          }}
                          className={cn(
                            "p-1 rounded transition-all",
                            isEditing ? "text-primary" : "text-muted-foreground hover:text-white"
                          )}
                          title="Edit article"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            archiveArticle(a.id, true).then(() => {
                              queryClient.invalidateQueries({ queryKey: getGetArticlesQueryKey() });
                            });
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-amber-400 transition-all"
                          title="Archive article"
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={async e => {
                            e.stopPropagation();
                            if (exportingArticleId === a.id) return;
                            setExportingArticleId(a.id);
                            setExportProgress(0);
                            try {
                              const res = await fetch(`/api/articles/${a.id}/snippets`);
                              const snippets = await res.json();
                              await exportArticleToMp4(
                                { title: a.title, source: a.source || 'News', publishedAt: a.publishedAt },
                                snippets,
                                pct => setExportProgress(pct)
                              );
                            } catch (err) {
                              console.error('Export failed:', err);
                            } finally {
                              setExportingArticleId(null);
                              setExportProgress(0);
                            }
                          }}
                          disabled={exportingArticleId !== null}
                          className={cn(
                            "p-1 rounded transition-all",
                            exportingArticleId === a.id
                              ? "text-primary cursor-wait"
                              : "text-muted-foreground hover:text-green-400"
                          )}
                          title={exportingArticleId === a.id ? `Exporting… ${exportProgress}%` : "Export as MP4"}
                        >
                          {exportingArticleId === a.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Download className="w-3.5 h-3.5" />
                          }
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); deleteMutation.mutate({ id: a.id }); }}
                          disabled={deleteMutation.isPending}
                          className="p-1 rounded text-muted-foreground hover:text-destructive transition-all"
                          title="Delete article"
                        >
                          {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    {/* Inline edit panel */}
                    {isEditing && (
                      <SidebarArticleEditor
                        article={a}
                        onClose={() => setEditingArticleId(null)}
                        onSaved={updated => {
                          setArticleOverrides(prev => ({ ...prev, [updated.id]: updated }));
                          queryClient.invalidateQueries({ queryKey: getGetArticlesQueryKey() });
                        }}
                      />
                    )}
                  </div>
                );
              })
            )}
          </>)}
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* Tab switcher */}
          <div className="flex items-center gap-1 border-b border-border mb-6">
            <button
              onClick={() => setMainTab('broadcast')}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px",
                mainTab === 'broadcast' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-white"
              )}
            >
              <Radio className="w-3.5 h-3.5" /> Broadcast
            </button>
            <button
              onClick={() => setMainTab('waiting')}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px",
                mainTab === 'waiting' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-white"
              )}
            >
              <Settings2 className="w-3.5 h-3.5" /> Waiting Screen
            </button>
            <button
              onClick={() => setMainTab('archive')}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px",
                mainTab === 'archive' ? "border-amber-500 text-amber-400" : "border-transparent text-muted-foreground hover:text-white"
              )}
            >
              <Archive className="w-3.5 h-3.5" /> Archive
              {archivedArticles.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400">
                  {archivedArticles.length}
                </span>
              )}
            </button>
          </div>

          <div className="space-y-6">
          {mainTab === 'archive' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-4">
                <Archive className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-foreground">Archived Articles</h2>
                <span className="text-xs text-muted-foreground">({archivedArticles.length})</span>
              </div>
              {archivedArticles.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <Archive className="w-8 h-8 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">No archived articles</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Archived articles will appear here</p>
                </div>
              ) : (
                archivedArticles.map(article => (
                  <div key={article.id} className="flex items-start gap-4 p-4 rounded-xl border border-border bg-card/30 hover:bg-card/50 transition-all">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
                        {article.source || 'Unknown'} · {new Date(article.publishedAt).toLocaleDateString()}
                      </p>
                      <p className="text-sm font-medium text-white/70 leading-snug">{article.title}</p>
                      {article.snippetCount > 0 && (
                        <p className="text-[10px] text-muted-foreground/50 mt-1">{article.snippetCount} chapters (off ticker)</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => {
                          archiveArticle(article.id, false).then(() =>
                            queryClient.invalidateQueries({ queryKey: getGetArticlesQueryKey() })
                          );
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-all"
                        title="Restore article"
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" /> Restore
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate({ id: article.id })}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-all"
                        title="Delete permanently"
                      >
                        {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : mainTab === 'waiting' ? (
            <WaitingScreenPanel />
          ) : (
            /* ── Broadcast Queue Panel ─────────────────────────────── */
            <div className="space-y-4">

              {/* Queue header + controls */}
              <div className="bg-card border border-border rounded-2xl p-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Radio className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm font-semibold">Broadcast Queue</span>
                    <span className="text-xs text-muted-foreground">({queue.length} item{queue.length !== 1 ? 's' : ''})</span>
                    {onAir && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-primary uppercase tracking-wider ml-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> ON AIR
                      </span>
                    )}
                  </div>

                  {/* Autoplay toggle */}
                  <button
                    onClick={async () => {
                      const next = !queueAutoplay;
                      setQueueAutoplay(next);
                      await apiSetQueueAutoplay(next);
                    }}
                    title={queueAutoplay ? 'Autoplay on — queue advances automatically' : 'Autoplay off — manually choose what plays next'}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all",
                      queueAutoplay
                        ? "bg-green-500/20 border-green-500/40 text-green-400"
                        : "border-border text-white/50 hover:text-white hover:bg-white/5"
                    )}
                  >
                    <Play className={cn("w-3.5 h-3.5", !queueAutoplay && "opacity-40")} />
                    Autoplay {queueAutoplay ? 'On' : 'Off'}
                  </button>

                  {/* Play All */}
                  <button
                    onClick={async () => {
                      if (queue.length === 0) return;
                      setVoiceEnabled(true);
                      await apiSetQueueAutoplay(true);
                      await apiPlayQueueItem(0);
                      await loadQueue();
                    }}
                    disabled={queue.length === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-all"
                  >
                    <Play className="w-4 h-4" /> Play All
                  </button>

                  {/* Stop */}
                  {onAir && (
                    <button
                      onClick={async () => {
                        setOnAir(false);
                        setPlayingQueueIndex(-1);
                        setVoiceEnabled(false);
                        stop();
                        await fetch('/api/playback/queue/stop', { method: 'POST' });
                        await loadQueue();
                      }}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl border border-destructive/30 text-destructive/70 text-sm hover:bg-destructive/10 transition-all"
                    >
                      <Pause className="w-4 h-4" /> Stop
                    </button>
                  )}
                </div>

                {queue.length === 0 && (
                  <p className="text-xs text-muted-foreground/60 mt-3 pl-6">
                    Hover an article or video in the sidebar and click <span className="text-primary font-semibold">+</span> to add it here.
                  </p>
                )}
              </div>

              {/* Queue list */}
              {queue.length > 0 && (
                <div className="space-y-2">
                  {queue.map((item, idx) => {
                    const isActive = idx === playingQueueIndex && onAir;
                    return (
                      <div
                        key={idx}
                        className={cn(
                          "group flex items-center gap-3 p-4 rounded-xl border transition-all",
                          isActive
                            ? "bg-primary/12 border-primary/35"
                            : "border-border bg-card/20 hover:bg-card/40"
                        )}
                      >
                        {/* Position / live dot */}
                        <div className="w-5 shrink-0 text-center">
                          {isActive
                            ? <span className="w-2 h-2 rounded-full bg-primary animate-pulse inline-block" />
                            : <span className="text-xs text-muted-foreground/40">{idx + 1}</span>
                          }
                        </div>

                        {/* Type icon */}
                        {item.type === 'article'
                          ? <FileText className="w-4 h-4 shrink-0 text-blue-400/70" />
                          : <Play className="w-4 h-4 shrink-0 text-purple-400/70" />
                        }

                        {/* Title + status */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium line-clamp-1 text-white/85">{item.title}</p>
                          <p className="text-[10px] uppercase tracking-wide mt-0.5">
                            <span className="text-muted-foreground">{item.type === 'article' ? 'Article' : 'Video'}</span>
                            {isActive && <span className="ml-2 text-primary font-semibold">● LIVE</span>}
                          </p>
                        </div>

                        {/* Reorder + remove (on hover) */}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={async () => {
                              if (idx === 0) return;
                              const newQ = [...queue];
                              [newQ[idx - 1], newQ[idx]] = [newQ[idx], newQ[idx - 1]];
                              setQueue(newQ);
                              await apiReorderQueue(newQ);
                            }}
                            disabled={idx === 0}
                            className="p-1.5 rounded text-muted-foreground hover:text-white disabled:opacity-20 transition-colors"
                            title="Move up"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              if (idx === queue.length - 1) return;
                              const newQ = [...queue];
                              [newQ[idx], newQ[idx + 1]] = [newQ[idx + 1], newQ[idx]];
                              setQueue(newQ);
                              await apiReorderQueue(newQ);
                            }}
                            disabled={idx === queue.length - 1}
                            className="p-1.5 rounded text-muted-foreground hover:text-white disabled:opacity-20 transition-colors"
                            title="Move down"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              const newItems = await apiRemoveFromQueue(idx);
                              setQueue(newItems);
                              await loadQueue();
                            }}
                            className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                            title="Remove from queue"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Play button */}
                        <button
                          onClick={async () => {
                            await apiPlayQueueItem(idx);
                            await loadQueue();
                          }}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all shrink-0",
                            isActive
                              ? "bg-primary/20 border-primary/40 text-primary"
                              : "border-border text-white/50 hover:text-white hover:bg-white/10 hover:border-white/20"
                          )}
                        >
                          <Play className="w-3 h-3" />
                          {isActive ? 'Playing' : 'Play'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Article chapter controls — shown when an article is playing */}
              {playingArticleId !== null && onAir && (
                <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-semibold text-white/80">Chapter Controls</span>
                    <span className="text-xs text-muted-foreground">
                      — {playingQueueItem?.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={handlePrev}
                      disabled={currentSnippetIndex === 0 || isLoadingSnippets}
                      className="p-2.5 rounded-xl border border-border text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                      {isLoadingSnippets ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronLeft className="w-5 h-5" />}
                    </button>

                    <div className="flex-1 text-center">
                      {isLoadingSnippets ? (
                        <Loader2 className="w-4 h-4 animate-spin mx-auto text-primary/40" />
                      ) : currentSnippet ? (
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">
                            Chapter {currentSnippetIndex + 1} of {snippets.length}
                          </p>
                          <p className="text-sm font-semibold text-white line-clamp-1">{currentSnippet.headline}</p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No chapters</p>
                      )}
                    </div>

                    <button
                      onClick={handleNext}
                      disabled={isLoadingSnippets}
                      className="p-2.5 rounded-xl border border-border text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                      {isLoadingSnippets ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5" />}
                    </button>

                    <button
                      onClick={() => {
                        if (!autoPlay && playingArticleId) {
                          stop();
                          prevIndexRef.current = -1;
                          updatePlayback(playingArticleId, 0);
                        }
                        setAutoPlay(v => !v);
                      }}
                      title={autoPlay ? `Auto-advancing every ${AUTO_PLAY_SECONDS}s` : 'Auto-play chapters off'}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all",
                        autoPlay
                          ? "bg-green-500/20 border-green-500/40 text-green-400"
                          : "border-border text-white/50 hover:text-white hover:bg-white/5"
                      )}
                    >
                      {autoPlay ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      {autoPlay ? 'Auto' : 'Manual'}
                    </button>

                    <button
                      onClick={() => { setVoiceEnabled(v => !v); if (voiceEnabled) stop(); }}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all",
                        voiceEnabled
                          ? "bg-primary/20 border-primary/40 text-primary"
                          : "border-border text-white/50 hover:text-white hover:bg-white/5"
                      )}
                    >
                      {isVoiceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : voiceEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                      {voiceEnabled ? 'Voice On' : 'Voice Off'}
                    </button>

                  </div>

                  {/* Chapter list */}
                  {snippets.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-border">
                      <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">
                        Chapters ({snippets.length}) · Click to jump
                      </p>
                      <div className="space-y-1.5">
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
                    </div>
                  )}
                </div>
              )}

            </div>
          )}
          </div>
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

      {/* Add Video Drawer */}
      <AnimatePresence>
        {showAddVideoDrawer && (
          <AddVideoDrawer
            onClose={() => setShowAddVideoDrawer(false)}
            onAdded={() => { setShowAddVideoDrawer(false); reloadVideos(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
