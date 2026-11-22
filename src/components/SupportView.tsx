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
import { addDoc, collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { SupportMessage, SupportTicket } from '../types/shinecab';

interface SupportViewProps {
  userId: string;
  customerId: string;
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
  { value: 'Bhojpuri', label: 'भोजपुरी (Bhojpuri)' },
];

const FAQS = [
  {
    q: 'How is my SHINE CAB fare calculated?',
    a: 'Fares are calculated automatically from live admin tariff rules (base fare, per-km distance rate, minimum fare, surge multiplier if any, and validated promo coupon discounts).',
  },
  {
    q: 'How does Ride OTP verification work?',
    a: 'When your assigned driver arrives at pickup, verify the captain and vehicle number plate, then share the 4-digit OTP shown on your active ride card to start the trip.',
  },
  {
    q: 'What if a payment fails or needs a refund?',
    a: 'Failed transactions are logged automatically without double charging. You can request a refund directly from Profile -> Payments & Receipts or open a support ticket below.',
  },
  {
    q: 'How do I report a lost item or safety concern?',
    a: 'Open a support ticket using the Lost Item or Safety category below, or trigger Emergency SOS immediately for 24x7 Safety Ops dispatch.',
  },
];

const QUICK_PROMPTS = [
  'Ride ka kiraya kaise calculate hota hai?',
  'Nearby driver kaise search aur book kare?',
  'Payment refund kaise milega?',
  'Gaadi mein saman chut gaya hai',
  'Ride OTP aur SOS safety kaise kaam karti hai?',
];

function getSmartFallbackBotReply(prompt: string, language: string): string {
  const lower = prompt.toLowerCase();
  const isEnglishOnly = language === 'English';

  if (lower.includes('kiraya') || lower.includes('fare') || lower.includes('price') || lower.includes('rate')) {
    return isEnglishOnly
      ? 'SHINE CAB fares use real OpenStreetMap road distance plus live Admin tariffs (base fare + per-km rate + minimum fare). You can apply valid coupon codes on the Home booking sheet before confirming.'
      : 'SHINE CAB mein kiraya live Admin tariff (base fare + per km rate + minimum fare) aur OpenStreetMap road distance ke hisaab se calculate hota hai. Book karne se pehle aap Promo Code bhi apply kar sakte hain.';
  }
  if (lower.includes('refund') || lower.includes('payment') || lower.includes('paisa') || lower.includes('upi')) {
    return isEnglishOnly
      ? 'For payment or refund help, go to Profile -> Payments, Methods & Receipts and tap "Request Refund" on your transaction, or create a Payment & Refund support ticket below.'
      : 'Payment ya refund ke liye Profile -> Payments & Receipts mein jaakar "Request Refund" par tap karein, ya neeche "Payment & Refund" category ke saath ek Support Ticket banayein.';
  }
  if (lower.includes('saman') || lower.includes('lost') || lower.includes('item') || lower.includes('bag')) {
    return isEnglishOnly
      ? 'If you left an item in the cab, check My Rides -> Driver History to call or chat with your captain immediately, and submit a "Lost Item Report" ticket below with your Ride Code.'
      : 'Agar gaadi mein koi saman chut gaya hai, to My Rides -> Driver History mein jaakar apne driver ko turant Call/Chat karein, aur neeche "Lost Item Report" ticket zaroor submit karein.';
  }
  if (lower.includes('otp') || lower.includes('sos') || lower.includes('safety')) {
    return isEnglishOnly
      ? 'Your unique 4-digit Ride OTP appears on the Active Ride card. Share it only when sitting inside the cab. In any emergency, tap the red SOS button anytime for instant helpline (112) & live location alert.'
      : 'Aapka 4-digit Ride OTP Active Ride card par dikhta hai — gaadi mein baithne ke baad hi driver ko batayein. Kisi bhi emergency mein upar laal SOS button dabayein (112 helpline aur live alert ke liye).';
  }
  if (lower.includes('book') || lower.includes('driver') || lower.includes('nearby') || lower.includes('pickup')) {
    return isEnglishOnly
      ? 'On the Home screen, tap Current GPS or search any village/city/road in Pickup & Drop, pick Bike, Auto, or Cab, and tap Book Ride. Nearby online drivers are notified immediately.'
      : 'Home screen par Pickup aur Drop address search karein (ya Current GPS dabayein), Bike/Auto/Cab chunein, aur Book Ride par tap karein. Aas-paas ke verified drivers turant live dikhte hain.';
  }

  return isEnglishOnly
    ? 'Thank you for contacting SHINE CAB Support! For instant help with any ride, fare, lost item, or payment issue, please create a Support Ticket right below and our team will respond shortly.'
    : 'SHINE CAB Support se sampark karne ke liye dhanyavaad! Kisi bhi ride, kiraya, payment ya lost item ki madad ke liye aap neeche "Create Support Ticket" form submit kar sakte hain. Humari team turant madad karegi.';
}

export const SupportView: React.FC<SupportViewProps> = ({
  userId,
  customerId,
  tickets,
  preselectedRideId,
  onTicketsChanged,
  onTriggerSos,
}) => {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [category, setCategory] = useState<SupportTicket['category']>('ride');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [replyText, setReplyText] = useState('');

  // Shine Support Chatbot state
  const [botMessages, setBotMessages] = useState<BotChatItem[]>([
    {
      id: 'welcome',
      role: 'model',
      text: 'Namaste! Main Shine hoon. Aap kisi bhi Indian language mein type ya pooch sakte hain — ride booking, kiraya, refund, driver chat, ya safety.',
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

  // Real-time Firestore listener for ticket messages
  useEffect(() => {
    if (!activeTicket || !userId) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'support_messages'),
      where('ticket_id', '==', activeTicket.id),
      where('customer_uid', '==', userId)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }) as SupportMessage)
          .sort(
            (a, b) =>
              new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
          );
        setMessages(list);
      },
      (err) => {
        console.error('Support messages listener error:', err);
      }
    );

    return () => unsub();
  }, [activeTicket, userId]);

  const stopAudioPlayback = () => {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
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
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json();
        if (data.audioBase64) {
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
          await audio.play().catch(() => setSpeakingId(null));
          return;
        }
      }

      // Safe Web Speech fallback in Android WebView / browser
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(clean);
        utter.lang = selectedLanguage === 'English' ? 'en-IN' : 'hi-IN';
        utter.onend = () => setSpeakingId(null);
        utter.onerror = () => setSpeakingId(null);
        window.speechSynthesis.speak(utter);
        return;
      }
      setSpeakingId(null);
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
      if (!res.ok || !res.body || contentType.includes('text/html') || contentType.includes('application/json')) {
        // Offline / static WebView fallback — never throw Unexpected token '<'
        const fallbackText = getSmartFallbackBotReply(trimmed, selectedLanguage);
        setBotMessages((prev) => [
          ...prev,
          { id: botMsgId, role: 'model', text: fallbackText, time: botTime },
        ]);
        if (options?.viaVoice && autoSpeak) {
          void speakText(botMsgId, fallbackText);
        }
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
              const fallbackText = getSmartFallbackBotReply(trimmed, selectedLanguage);
              setBotMessages((prev) => [
                ...prev,
                { id: botMsgId, role: 'model', text: fallbackText, time: botTime },
              ]);
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

      if (!insertedBotBubble) {
        const fallbackText = getSmartFallbackBotReply(trimmed, selectedLanguage);
        accumulatedReply = fallbackText;
        setBotMessages((prev) => [
          ...prev,
          { id: botMsgId, role: 'model', text: fallbackText, time: botTime },
        ]);
      }

      if (options?.viaVoice && autoSpeak && accumulatedReply.trim()) {
        void speakText(botMsgId, accumulatedReply);
      }
    } catch {
      const fallbackText = getSmartFallbackBotReply(trimmed, selectedLanguage);
      setBotMessages((prev) => [
        ...prev,
        { id: botMsgId, role: 'model', text: fallbackText, time: botTime },
      ]);
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
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) {
            setBotError('Voice server unavailable right now. Please type your message below.');
            return;
          }
          const data = await res.json();
          if (!res.ok || !data.text) {
            setBotError(data.error || 'Could not understand audio. Please try again.');
            return;
          }
          await sendToBot(data.text, { viaVoice: true });
        } catch {
          setBotError('Voice processing unavailable. Please type your message below.');
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
    setFormSuccess(null);
    if (!userId) {
      setFormError('Please sign in to submit a support ticket.');
      return;
    }
    if (!subject.trim() || !description.trim()) {
      setFormError('Please provide both subject and description.');
      return;
    }

    setSubmitting(true);
    const nowIso = new Date().toISOString();
    const ticketNumber = `TKT-${Date.now().toString().slice(-6)}`;

    try {
      const payload = {
        ticket_number: ticketNumber,
        customer_id: customerId || userId,
        customer_uid: userId,
        ride_id: preselectedRideId || null,
        category,
        subject: subject.trim(),
        description: description.trim(),
        priority: category === 'safety' ? ('urgent' as const) : ('normal' as const),
        status: 'open' as const,
        created_at: nowIso,
      };

      const ticketRef = await addDoc(collection(db, 'support_tickets'), payload);

      await addDoc(collection(db, 'support_messages'), {
        ticket_id: ticketRef.id,
        customer_uid: userId,
        sender_id: userId,
        sender_role: 'customer',
        message: description.trim(),
        created_at: nowIso,
      });

      setSubject('');
      setDescription('');
      setFormSuccess(`Ticket ${ticketNumber} created successfully.`);
      setActiveTicket({ id: ticketRef.id, ...payload });
      onTicketsChanged();
    } catch (err) {
      setFormError('Unable to submit support ticket. Please try again.');
      try {
        handleFirestoreError(err, OperationType.CREATE, 'support_tickets');
      } catch {
        // logged
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !userId || !replyText.trim()) return;
    const text = replyText.trim();
    setReplyText('');
    try {
      await addDoc(collection(db, 'support_messages'), {
        ticket_id: activeTicket.id,
        customer_uid: userId,
        sender_id: userId,
        sender_role: 'customer',
        message: text,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      setReplyText(text);
      try {
        handleFirestoreError(err, OperationType.CREATE, 'support_messages');
      } catch {
        // logged
      }
    }
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
                  All Indian Languages · Instant Help
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
                    text: 'Namaste! Main Shine hoon. Aap kisi bhi Indian language mein type ya pooch sakte hain — ride booking, kiraya, refund, driver chat, ya safety.',
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
        <div className="p-3.5 space-y-3 h-[280px] overflow-y-auto bg-white">
          {botMessages.map((msg) => {
            const isUser = msg.role === 'user';
            const isPlayingThis = speakingId === msg.id;
            return (
              <div
                key={msg.id}
                className={`flex flex-col max-w-[85%] ${
                  isUser ? 'ml-auto items-end' : 'mr-auto items-start'
                }`}
              >
                <div
                  className={`px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
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
          <div className="p-3 border-t border-red-200 bg-red-50 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-3 h-3 rounded-full bg-[#DC2626] animate-ping shrink-0" />
              <p className="text-xs font-semibold text-[#DC2626] truncate">
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
            className="p-3 border-t border-neutral-200 bg-[#F7F8FA] flex items-center gap-2"
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
            </button>

            <input
              type="text"
              value={botInput}
              onChange={(e) => setBotInput(e.target.value)}
              placeholder="Apni bhasha mein likhein ya poochein..."
              maxLength={600}
              disabled={transcribing}
              className="flex-1 min-w-0 h-11 rounded-xl border border-neutral-300 bg-white px-3 text-xs text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
            />
            <button
              type="submit"
              disabled={botLoading || transcribing || !botInput.trim()}
              aria-label="Send message to Shine"
              className="min-h-[44px] px-3.5 rounded-xl bg-[#FFC928] text-[#111111] font-bold text-xs inline-flex items-center gap-1.5 hover:brightness-95 disabled:opacity-50 cursor-pointer shrink-0"
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
          {formSuccess && <p className="text-xs text-[#16A34A] font-medium">{formSuccess}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[44px] rounded-xl bg-[#FFC928] text-[#111111] font-semibold text-xs hover:brightness-95 cursor-pointer disabled:opacity-60"
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
                  className="flex-1 min-w-0 h-11 rounded-xl border border-neutral-300 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
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
