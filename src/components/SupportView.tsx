import React, { useEffect, useRef, useState } from 'react';
import {
  LifeBuoy,
  Send,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Bot,
  RotateCcw,
  Mic,
  Square,
  Volume2,
  VolumeX,
  Languages,
  X,
} from 'lucide-react';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupportMessage, SupportTicket } from '../types/shinecab';

interface SupportViewProps {
  supabase: SupabaseClient | null;
  userId: string | null;
  customerId: string | null;
  tickets: SupportTicket[];
  preselectedRideId?: string | null;
  onTicketsChanged: () => void;
  onTriggerSos: () => void;
}

interface BotChatItem {
  id: string;
  role: 'user' | 'model';
  text: string;
  time: string;
  viaVoice?: boolean;
}

const INDIAN_LANGUAGES = [
  { value: 'auto', label: 'Auto (All Indian Languages)' },
  { value: 'Hindi', label: 'हिन्दी (Hindi)' },
  { value: 'Hinglish', label: 'Hinglish' },
  { value: 'English', label: 'English' },
  { value: 'Bengali', label: 'বাংলা (Bengali)' },
  { value: 'Tamil', label: 'தமிழ் (Tamil)' },
  { value: 'Telugu', label: 'తెలుగు (Telugu)' },
  { value: 'Marathi', label: 'मराठी (Marathi)' },
  { value: 'Gujarati', label: 'ગુજરાતી (Gujarati)' },
  { value: 'Kannada', label: 'ಕನ್ನಡ (Kannada)' },
  { value: 'Malayalam', label: 'മലയാളം (Malayalam)' },
  { value: 'Punjabi', label: 'ਪੰਜਾਬੀ (Punjabi)' },
  { value: 'Odia', label: 'ଓଡ଼ିଆ (Odia)' },
  { value: 'Urdu', label: 'اردو (Urdu)' },
  { value: 'Assamese', label: 'অসমীয়া (Assamese)' },
  { value: 'Bhojpuri', label: 'भोजपुरी (Bhojpuri)' },
  { value: 'Maithili', label: 'मैथिली (Maithili)' },
  { value: 'Nepali', label: 'नेपाली (Nepali)' },
  { value: 'Konkani', label: 'कोंकणी (Konkani)' },
  { value: 'Manipuri', label: 'মৈতৈলোন্ (Manipuri)' },
  { value: 'Santali', label: 'ᱥᱟᱱᱛᱟᱲᱤ (Santali)' },
];

const FAQS = [
  {
    q: 'How is my SHINE CAB fare calculated?',
    a: 'Fares are calculated from base fare, real route distance in km, ride duration, applicable taxes, and validated promo discounts.',
  },
  {
    q: 'How does Ride OTP verification work?',
    a: 'When your assigned driver arrives at pickup, verify the captain and vehicle number plate, then share the 4-digit OTP shown on your active ride card to start the trip.',
  },
  {
    q: 'What if a Razorpay payment fails or needs a refund?',
    a: 'Failed transactions are logged automatically without double charging. For captured payments, you can request a refund from Profile -> Payments & Receipts or open a ticket below.',
  },
  {
    q: 'How do I report a lost item or safety concern?',
    a: 'Ask the Support Bot for instant guidance, open a ticket using the Lost Item or Safety category below, or trigger Emergency SOS immediately.',
  },
];

const QUICK_PROMPTS = [
  'Ride ka kiraya kaise calculate hota hai?',
  'Nearby driver kaise search aur book kare?',
  'Payment refund kaise milega?',
  'Gaadi mein saman chut gaya hai',
  'Ride OTP aur SOS safety kaise kaam karti hai?',
];

export const SupportView: React.FC<SupportViewProps> = ({
  supabase,
  userId,
  customerId,
  tickets,
  preselectedRideId,
  onTicketsChanged,
  onTriggerSos,
}) => {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [category, setCategory] = useState<SupportTicket['category']>(
    preselectedRideId ? 'ride' : 'ride'
  );
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [replyText, setReplyText] = useState('');

  // Shine Support Chatbot state
  const [botMessages, setBotMessages] = useState<BotChatItem[]>([
    {
      id: 'welcome',
      role: 'model',
      text: 'Namaste! Main Shine hoon. Aap kisi bhi Indian language mein type ya mic se bolkar pooch sakte hain — ride booking, kiraya, refund, driver chat, ya safety.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('auto');
  const [botInput, setBotInput] = useState('');
  const [botLoading, setBotLoading] = useState(false);
  const [botError, setBotError] = useState<string | null>(null);

  // Voice chat & TTS playback state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const botScrollRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    botScrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [botMessages, botLoading, transcribing]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      setRecordingSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    return () => {
      discardRecordingRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!supabase || !activeTicket) return;
    const loadMessages = async () => {
      const { data } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', activeTicket.id)
        .order('created_at', { ascending: true });
      setMessages((data as SupportMessage[]) || []);
    };
    loadMessages();

    const channel = supabase
      .channel(`ticket-${activeTicket.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `ticket_id=eq.${activeTicket.id}`,
        },
        (payload) => {
          const msg = payload.new as SupportMessage;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, activeTicket]);

  const stopAudioPlayback = () => {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    setSpeakingId(null);
  };

  const speakText = async (messageId: string, textToSpeak: string) => {
    const clean = textToSpeak.trim();
    if (!clean) return;
    if (speakingId === messageId) {
      stopAudioPlayback();
      return;
    }
    stopAudioPlayback();
    setSpeakingId(messageId);
    try {
      const res = await fetch('/api/support/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean }),
      });
      const data = await res.json();
      if (!res.ok || !data.audioBase64) {
        setSpeakingId(null);
        return;
      }
      const audio = new Audio(`data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`);
      activeAudioRef.current = audio;
      audio.onended = () => {
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
        setSpeakingId(null);
      };
      audio.onerror = () => {
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
        setSpeakingId(null);
      };
      await audio.play().catch(() => {
        setSpeakingId(null);
      });
    } catch {
      setSpeakingId(null);
    }
  };

  const sendToBot = async (textToSend: string, options?: { viaVoice?: boolean }) => {
    const trimmed = textToSend.trim();
    if (!trimmed || botLoading) return;

    stopAudioPlayback();

    const userMsg: BotChatItem = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      viaVoice: options?.viaVoice,
    };

    const nextHistory = [...botMessages, userMsg];
    setBotMessages(nextHistory);
    setBotInput('');
    setBotError(null);
    setBotLoading(true);

    const botMsgId = `b-${Date.now()}`;
    const botTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let insertedBotBubble = false;
    let accumulatedReply = '';

    try {
      const apiMessages = nextHistory
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({ role: m.role, text: m.text }));

      const res = await fetch('/api/support/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, language: selectedLanguage }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !res.body || contentType.includes('application/json')) {
        const data = await res.json().catch(() => ({}));
        setBotError(data.error || 'Shine is temporarily unavailable.');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payloadStr = line.slice(5).trim();
          if (!payloadStr) continue;
          try {
            const payload = JSON.parse(payloadStr) as {
              chunk?: string;
              done?: boolean;
              error?: string;
            };
            if (payload.error) {
              setBotError(payload.error);
              return;
            }
            if (payload.chunk) {
              accumulatedReply += payload.chunk;
              if (!insertedBotBubble) {
                insertedBotBubble = true;
                setBotMessages((prev) => [
                  ...prev,
                  { id: botMsgId, role: 'model', text: payload.chunk || '', time: botTime },
                ]);
              } else {
                setBotMessages((prev) =>
                  prev.map((m) =>
                    m.id === botMsgId ? { ...m, text: m.text + payload.chunk } : m
                  )
                );
              }
            }
          } catch {
            // ignore incomplete SSE line
          }
        }
      }

      if (options?.viaVoice && autoSpeak && accumulatedReply.trim()) {
        void speakText(botMsgId, accumulatedReply);
      }
    } catch {
      setBotError('Network error while connecting to Shine.');
    } finally {
      setBotLoading(false);
    }
  };

  const startVoiceRecording = async () => {
    if (isRecording || transcribing || botLoading) return;
    setBotError(null);
    stopAudioPlayback();

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setBotError('Microphone voice recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      const chosenType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = chosenType ? new MediaRecorder(stream, { mimeType: chosenType }) : new MediaRecorder(stream);

      audioChunksRef.current = [];
      discardRecordingRef.current = false;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);

        if (discardRecordingRef.current || audioChunksRef.current.length === 0) {
          return;
        }

        const mimeType = recorder.mimeType || chosenType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size < 400) {
          setBotError('Recording too short. Please tap mic, speak clearly, then send.');
          return;
        }

        setTranscribing(true);
        try {
          const base64DataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Failed to read recorded audio.'));
            reader.readAsDataURL(blob);
          });

          const res = await fetch('/api/support/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: base64DataUrl,
              mimeType,
              language: selectedLanguage,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.text) {
            setBotError(data.error || 'Could not understand audio. Please try again.');
            return;
          }
          await sendToBot(data.text, { viaVoice: true });
        } catch {
          setBotError('Voice processing failed. Please check mic permissions and try again.');
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      setRecordingSec(0);
      setIsRecording(true);
      recorder.start(250);
    } catch {
      setBotError('Microphone permission denied. Please allow mic access to use voice chat.');
    }
  };

  const stopAndSendVoice = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      discardRecordingRef.current = false;
      mediaRecorderRef.current.stop();
    }
  };

  const cancelVoiceRecording = () => {
    discardRecordingRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      setIsRecording(false);
    }
  };

  const handleBotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendToBot(botInput);
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!supabase || !customerId || !userId) {
      setFormError(
        'Ticket history sync requires signed-in Supabase account. Chat with Shine above for instant help anytime.'
      );
      return;
    }
    if (!subject.trim() || !description.trim()) {
      setFormError('Please provide both subject and description.');
      return;
    }

    setSubmitting(true);
    try {
      const ticketNumber = `TKT-${Date.now().toString().slice(-6)}`;
      const { data: ticket, error } = await supabase
        .from('support_tickets')
        .insert({
          ticket_number: ticketNumber,
          customer_id: customerId,
          ride_id: preselectedRideId || null,
          category,
          subject: subject.trim(),
          description: description.trim(),
          priority: category === 'safety' ? 'urgent' : 'normal',
        })
        .select('*')
        .single();

      if (error || !ticket) {
        setFormError(error?.message || 'Unable to submit support ticket.');
        return;
      }

      await supabase.from('support_messages').insert({
        ticket_id: ticket.id,
        sender_id: userId,
        sender_role: 'customer',
        message: description.trim(),
      });

      setSubject('');
      setDescription('');
      setActiveTicket(ticket as SupportTicket);
      onTicketsChanged();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !activeTicket || !userId || !replyText.trim()) return;
    const text = replyText.trim();
    setReplyText('');
    await supabase.from('support_messages').insert({
      ticket_id: activeTicket.id,
      sender_id: userId,
      sender_role: 'customer',
      message: text,
    });
  };

  return (
    <div className="w-full p-4 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold text-[#111111]">Help & Support</h1>
          <p className="text-xs text-[#737373] truncate">
            Chat with Shine or create a support ticket
          </p>
        </div>
        <button
          type="button"
          onClick={onTriggerSos}
          className="min-h-[42px] px-3.5 rounded-xl bg-[#DC2626] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:bg-red-700 cursor-pointer shrink-0"
        >
          <ShieldAlert className="w-4 h-4" />
          <span>SOS</span>
        </button>
      </div>

      {/* Interactive Shine Voice & Multilingual Chatbot Card */}
      <div className="bg-white rounded-3xl border border-neutral-200 shadow-sm overflow-hidden">
        <div className="bg-[#111111] text-white p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#FFC928] text-[#111111] flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-sm font-bold truncate">Shine</h2>
                <p className="text-[11px] text-neutral-300 truncate">
                  All Indian Languages · Fast Voice & Text
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                stopAudioPlayback();
                setBotMessages([
                  {
                    id: 'welcome',
                    role: 'model',
                    text: 'Namaste! Main Shine hoon. Aap kisi bhi Indian language mein type ya mic se bolkar pooch sakte hain — ride booking, kiraya, refund, driver chat, ya safety.',
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  },
                ]);
                setBotError(null);
              }}
              className="min-h-[36px] px-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-[11px] font-semibold text-white inline-flex items-center gap-1 cursor-pointer shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex-1 min-w-0 inline-flex items-center gap-1.5 bg-white/10 rounded-xl px-2.5 h-9 text-[11px] text-white">
              <Languages className="w-3.5 h-3.5 text-[#FFC928] shrink-0" />
              <select
                aria-label="Select chat language"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="w-full bg-transparent text-white text-[11px] font-semibold focus:outline-none cursor-pointer truncate"
              >
                {INDIAN_LANGUAGES.map((lang) => (
                  <option key={lang.value} value={lang.value} className="text-[#111111] bg-white">
                    {lang.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => {
                if (autoSpeak) stopAudioPlayback();
                setAutoSpeak((v) => !v);
              }}
              title={autoSpeak ? 'Mute voice reply' : 'Enable voice reply'}
              className={`min-h-[36px] px-3 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0 ${
                autoSpeak
                  ? 'bg-[#FFC928] text-[#111111]'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              {autoSpeak ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span>{autoSpeak ? 'Voice On' : 'Voice Off'}</span>
            </button>
          </div>
        </div>

        {/* Quick Questions */}
        <div className="px-3.5 py-2 bg-[#F7F8FA] border-b border-neutral-200 flex items-center gap-2 overflow-x-auto no-scrollbar">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={botLoading || transcribing}
              onClick={() => sendToBot(q)}
              className="min-h-[34px] px-3 rounded-xl border border-neutral-200 bg-white text-[11px] font-medium text-[#111111] hover:bg-[#FFC928]/20 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Chat Messages Feed */}
        <div className="p-3.5 space-y-3 h-[300px] overflow-y-auto bg-white">
          {botMessages.map((msg) => {
            const isUser = msg.role === 'user';
            const isPlayingThis = speakingId === msg.id;
            return (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${
                  isUser ? 'ml-auto items-end' : 'mr-auto items-start'
                }`}
              >
                <div
                  className={`px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                    isUser
                      ? 'bg-[#111111] text-white rounded-br-sm'
                      : 'bg-[#F7F8FA] text-[#111111] border border-neutral-200 rounded-bl-sm'
                  }`}
                >
                  {msg.text}
                </div>
                <div className="flex items-center gap-2 mt-1 px-1">
                  <span className="text-[10px] text-[#737373] font-mono-num">
                    {isUser ? (msg.viaVoice ? 'You · Voice' : 'You') : 'Shine'} · {msg.time}
                  </span>
                  {!isUser && msg.text.trim().length > 0 && (
                    <button
                      type="button"
                      onClick={() => speakText(msg.id, msg.text)}
                      aria-label={isPlayingThis ? 'Stop voice playback' : 'Listen to Shine'}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#111111] hover:text-[#D97706] cursor-pointer"
                    >
                      {isPlayingThis ? (
                        <>
                          <Square className="w-3 h-3 fill-current" />
                          <span>Stop</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-3 h-3" />
                          <span>Listen</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {transcribing && (
            <div className="ml-auto bg-[#111111]/90 text-white rounded-2xl px-3.5 py-2.5 text-xs animate-pulse">
              Listening & understanding voice...
            </div>
          )}

          {botLoading && (
            <div className="mr-auto bg-[#F7F8FA] border border-neutral-200 rounded-2xl px-3.5 py-2.5 text-xs text-[#737373] animate-pulse">
              Shine is typing...
            </div>
          )}

          <div ref={botScrollRef} />
        </div>

        {botError && (
          <div className="mx-4 mb-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-[#DC2626]">
            {botError}
          </div>
        )}

        {/* Chat Input Bar + Mic Voice Chat */}
        {isRecording ? (
          <div className="p-3 sm:p-4 border-t border-red-200 bg-red-50 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-3 h-3 rounded-full bg-[#DC2626] animate-ping shrink-0" />
              <p className="text-xs sm:text-sm font-semibold text-[#DC2626] truncate">
                Recording voice...{' '}
                <span className="font-mono-num">
                  0:{recordingSec < 10 ? `0${recordingSec}` : recordingSec}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={cancelVoiceRecording}
                aria-label="Cancel voice recording"
                className="min-h-[44px] px-3 rounded-xl border border-neutral-300 bg-white text-[#111111] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span>Cancel</span>
              </button>
              <button
                type="button"
                onClick={stopAndSendVoice}
                aria-label="Send voice message"
                className="min-h-[44px] px-4 rounded-xl bg-[#DC2626] text-white text-xs font-bold inline-flex items-center gap-1.5 hover:bg-red-700 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Send Voice</span>
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleBotSubmit}
            className="p-3 sm:p-4 border-t border-neutral-200 bg-[#F7F8FA] flex items-center gap-2"
          >
            <button
              type="button"
              disabled={botLoading || transcribing}
              onClick={startVoiceRecording}
              aria-label="Speak with microphone"
              title="Tap to speak in any Indian language"
              className="min-h-[44px] min-w-[44px] px-3 rounded-xl border border-neutral-300 bg-white text-[#111111] hover:bg-[#FFC928]/20 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
            >
              <Mic className="w-4 h-4 text-[#DC2626]" />
              <span className="hidden sm:inline text-xs font-semibold">Speak</span>
            </button>

            <input
              type="text"
              value={botInput}
              onChange={(e) => setBotInput(e.target.value)}
              placeholder="Apni bhasha mein likhein ya mic se bolein..."
              maxLength={600}
              disabled={transcribing}
              className="flex-1 h-11 rounded-xl border border-neutral-300 bg-white px-3.5 text-xs sm:text-sm text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
            />
            <button
              type="submit"
              disabled={botLoading || transcribing || !botInput.trim()}
              aria-label="Send message to Shine"
              className="min-h-[44px] px-4 rounded-xl bg-[#FFC928] text-[#111111] font-bold text-xs inline-flex items-center gap-1.5 hover:brightness-95 disabled:opacity-50 cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4" />
              <span>Send</span>
            </button>
          </form>
        )}
      </div>

      <div className="space-y-5">
        {/* New Support Ticket Form */}
        <form
          onSubmit={handleCreateTicket}
          className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-3.5"
        >
          <div className="flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-[#111111]" />
            <h2 className="font-display text-base font-bold text-[#111111]">
              Create Support Ticket
            </h2>
          </div>

          <label className="block space-y-1 text-xs font-semibold text-neutral-700">
            <span>Issue Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as SupportTicket['category'])}
              className="w-full h-11 rounded-xl border border-neutral-300 bg-[#F7F8FA] px-3 text-xs font-medium"
            >
              <option value="ride">Ride Issue</option>
              <option value="payment">Payment & Refund</option>
              <option value="driver">Driver Complaint</option>
              <option value="lost_item">Lost Item Report</option>
              <option value="safety">Safety Complaint</option>
              <option value="account">Account & Profile</option>
              <option value="other">Other</option>
            </select>
          </label>

          <label className="block space-y-1 text-xs font-semibold text-neutral-700">
            <span>Subject</span>
            <input
              type="text"
              required
              placeholder="Brief summary of your issue"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full h-11 rounded-xl border border-neutral-300 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
            />
          </label>

          <label className="block space-y-1 text-xs font-semibold text-neutral-700">
            <span>Description</span>
            <textarea
              rows={4}
              required
              placeholder="Include trip details, payment reference, or lost item description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 p-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
            />
          </label>

          {formError && <p className="text-xs text-[#DC2626] font-medium">{formError}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[44px] rounded-xl bg-[#FFC928] text-[#111111] font-semibold text-xs hover:brightness-95 cursor-pointer"
          >
            {submitting ? 'Submitting Ticket...' : 'Submit Ticket'}
          </button>
        </form>

        {/* Tickets & Conversation Thread */}
        <div className="space-y-5">
          <div className="bg-white rounded-3xl border border-neutral-200 p-4 space-y-3.5">
            <h2 className="font-display text-base font-bold text-[#111111]">Your Tickets</h2>
            {tickets.length === 0 ? (
              <p className="text-xs text-[#737373]">No support tickets created yet.</p>
            ) : (
              <div className="divide-y divide-neutral-100">
                {tickets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTicket(t)}
                    className={`w-full py-3 px-2 text-left flex items-center justify-between gap-3 rounded-xl hover:bg-[#F7F8FA] cursor-pointer ${
                      activeTicket?.id === t.id ? 'bg-[#FFC928]/15' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-mono-num text-[#737373]">
                        {t.ticket_number} · {t.category.replace('_', ' ')} ·{' '}
                        {t.status.replace('_', ' ')}
                      </p>
                      <p className="text-sm font-semibold text-[#111111] truncate">{t.subject}</p>
                    </div>
                    <MessageSquare className="w-4 h-4 text-[#737373] shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeTicket && (
            <div className="bg-white rounded-3xl border border-neutral-200 p-5 space-y-4">
              <div className="border-b border-neutral-100 pb-3">
                <p className="text-xs font-mono-num text-[#737373]">
                  {activeTicket.ticket_number} · {activeTicket.status.replace('_', ' ')}
                </p>
                <h3 className="font-display text-base font-bold text-[#111111]">
                  {activeTicket.subject}
                </h3>
              </div>

              <div className="space-y-2.5 max-h-64 overflow-y-auto">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`p-3 rounded-2xl text-xs max-w-[85%] ${
                      m.sender_role === 'customer'
                        ? 'ml-auto bg-[#111111] text-white'
                        : 'bg-[#F7F8FA] text-[#111111] border border-neutral-200'
                    }`}
                  >
                    <p>{m.message}</p>
                    <p className="text-[10px] opacity-60 mt-1 font-mono-num">
                      {m.sender_role === 'admin' ? 'Support Team' : 'You'} ·{' '}
                      {new Date(m.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                ))}
              </div>

              <form onSubmit={handleSendReply} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Write a reply..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  className="flex-1 h-11 rounded-xl border border-neutral-300 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
                />
                <button
                  type="submit"
                  className="min-h-[44px] px-4 rounded-xl bg-[#111111] text-[#FFC928] inline-flex items-center justify-center cursor-pointer"
                  aria-label="Send reply"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}

          {/* FAQ Accordion */}
          <div className="bg-white rounded-3xl border border-neutral-200 p-5 space-y-3">
            <h2 className="font-display text-base font-bold text-[#111111]">
              Frequently Asked Questions
            </h2>
            <div className="divide-y divide-neutral-100">
              {FAQS.map((f, idx) => (
                <div key={f.q} className="py-2.5">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                    className="w-full min-h-[44px] flex items-center justify-between gap-2 text-left text-xs font-semibold text-[#111111] cursor-pointer"
                  >
                    <span>{f.q}</span>
                    {openFaq === idx ? (
                      <ChevronUp className="w-4 h-4 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 shrink-0" />
                    )}
                  </button>
                  {openFaq === idx && (
                    <p className="text-xs text-[#737373] pb-2 leading-relaxed">{f.a}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
