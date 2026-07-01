import React, { useState, useEffect, useRef } from 'react';

import axios from 'axios';
import { supabase } from './supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send, Bot, User, LogOut, Plus, Mail,
  FileUp, Sparkles, MessageSquare, Moon, Zap,
  LayoutDashboard, Reply, Inbox,
  BarChart3, Calendar as CalendarIcon, Users, Bell, Settings as SettingsIcon, Search
} from 'lucide-react';
import { CopilotView } from './CopilotView';
import { CommandPalette } from './components/command/CommandPalette';
import { QuickActionFab } from './components/layout/QuickActionFab';
const API_URL = "http://localhost:8000";
function App() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [view, setView] = useState('dashboard'); // dashboard | chat | smartReply | inbox | analytics | calendar | contacts | notifications | settings | profile
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingTool, setPendingTool] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const chatEndRef = useRef(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // Compose / Send-email modal state
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeAttachResume, setComposeAttachResume] = useState(false);
  const [composeFile, setComposeFile] = useState(null);
  const [sending, setSending] = useState(false);

  // 1. Auth & Initial Data Load
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchConversations(session.user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchConversations(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  // --- OPEN A SPECIFIC CONVERSATION (load its messages into the chat window) ---
  const openConversation = async (conversationId) => {
    setView('chat');
    setActiveConversationId(conversationId);
    try {
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      setChat((data || []).map(m => ({ role: m.role, text: m.content })));
    } catch (e) { console.log(e); }
  };
  
// Pehle se maujood useEffect ke andar ya ek naya useEffect
useEffect(() => {
  if (user) {
    checkOnboardingStatus(user.id);
  }
}, [user]);

const checkOnboardingStatus = async (userId) => {
  console.log("Onboarding check shuru ho raha hai for:", userId);
  
  try {
    // 1. Gmail Token check karo
    const { data: profile } = await supabase
      .from('profiles')
      .select('gmail_token')
      .eq('id', userId)
      .maybeSingle();

    // 2. Resume check karo (Sirf list mangao, count dekho)
    const { data: resumes } = await supabase
      .from('resumes')
      .select('id')
      .eq('user_id', userId);

    console.log("Profile data mila:", profile);
    console.log("Resumes list mili:", resumes);

    // Sirf Gmail check karo - ek baar Gmail link ho gaya toh popup dobara mat dikhao
    // (Resume ab optional hai, use main UI se kabhi bhi upload kar sakte hain)
    if (!profile?.gmail_token) {
      console.log("Popup trigger ho raha hai...");
      setTimeout(() => {
        setShowOnboarding(true);
      }, 2000); // 2 second ka delay taaki page load ho jaye
    }
  } catch (error) {
    console.error("Onboarding crash:", error);
  }
};
  // --- FETCH CONVERSATION LIST (SIDEBAR) ---
  const fetchConversations = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('id, title, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(30);

      if (!error && data) setConversations(data);
    } catch (e) { console.error("Conversation fetch error:", e); }
  };

  const handleNewSession = () => {
    setView('chat');
    setChat([]);
    setActiveConversationId(null);
    setMessage('');
  };

  const handleLogin = async () => {
    if (!email || !password) return alert("Enter your Email and Password first!");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert("Login Error: " + error.message);
    else setUser(data.user);
  };
  
  const handleSignup = async () => {
    if (!email || !password) return alert("Email and password are required!");
    try {
      await axios.post(`${API_URL}/api/v1/auth/signup`, {
        email,
        password,
        full_name: email.split('@')[0],
      });
      alert("Account created successfully! Now you can Sign In.");
    } catch (error) {
      const msg = error.response?.data?.detail || error.message;
      alert("Signup Error: " + msg);
    }
  };

  const handleLogout = () => supabase.auth.signOut();

  // Open an AI writing tool from the command palette / FAB.
  // CopilotView hosts the tool modal, so ensure a non-chat view is active first.
  const handleOpenTool = (action) => {
    setView((v) => (v === 'chat' ? 'dashboard' : v));
    setPendingTool(action);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', user.id);

    setUploading(true);
    try {
      await axios.post(`${API_URL}/api/v1/profile/upload-resume`, formData);
      alert("✅ Resume Parsed Successfully!");
    } catch (error) { alert("❌ Upload failed."); }
    setUploading(false);
  };

  const handleGoogleLogin = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/v1/actions/login-google?user_id=${user.id}`);
      window.open(res.data.url, '_blank');
    } catch (e) { alert("Error connecting to Gmail API"); }
  };

  // Open the compose modal, prefilled with the AI draft
  const handleSendEmail = (subject, body) => {
    setComposeSubject(subject || "Smart Email Agent Draft");
    setComposeBody(body || "");
    setComposeTo('');
    setComposeAttachResume(false);
    setComposeFile(null);
    setShowCompose(true);
  };

  // Actually send the email (supports resume + any user-picked file attachment)
  const submitEmail = async () => {
    if (!composeTo) { alert("Please enter a recipient email."); return; }
    setSending(true);
    try {
      // multipart/form-data so we can include an arbitrary file attachment
      const formData = new FormData();
      formData.append('user_id', user.id);
      formData.append('to_email', composeTo);
      formData.append('subject', composeSubject || "Smart Email Agent Draft");
      formData.append('body', composeBody);
      formData.append('attach_resume', composeAttachResume);
      if (composeFile) formData.append('file', composeFile);

      const res = await axios.post(`${API_URL}/api/v1/actions/send-email`, formData);
      if (res.data.status === "success") {
        alert("🚀 Email Sent!");
        setShowCompose(false);
      }
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.detail || "Error sending email.";
      alert("❌ " + msg);
    }
    setSending(false);
  };

  const handleSendMessage = async () => {
    if (!message) return;
    setLoading(true);
    const currentMessage = message;
    setMessage('');
    setChat(prev => [...prev, { role: 'user', text: currentMessage }]);
    try {
      const response = await axios.post(`${API_URL}/api/v1/chat/`, {
        user_id: user.id,
        message: currentMessage,
        conversation_id: activeConversationId,
      });
      setChat(prev => [...prev, {
        role: 'assistant', text: response.data?.content || "Executed.",
        status: response.data?.status, metadata: response.data?.metadata
      }]);
      // Keep the thread active (a new conversation returns its fresh id)
      if (response.data?.conversation_id) setActiveConversationId(response.data.conversation_id);
      fetchConversations(user.id);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6 text-white font-sans">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-[#111] p-10 rounded-[2.5rem] border border-white/5 shadow-2xl w-full max-w-md">
          
          {/* Logo & Header */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-black shadow-xl shadow-white/10">
              <Zap size={32} fill="black" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-center mb-2 tracking-tight">Smart Email Agent</h1>
          <p className="text-center text-neutral-500 mb-8 text-sm font-medium">Your Smart Email Assistant</p>
          
          {/* Input Fields */}
          <div className="space-y-4">
            <input 
              className="w-full p-4 bg-white/5 border border-white/10 rounded-2xl outline-none focus:bg-white/10 transition-all text-white placeholder:text-neutral-600" 
              placeholder="Enter your email" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
            />
            <input 
              className="w-full p-4 bg-white/5 border border-white/10 rounded-2xl outline-none focus:bg-white/10 transition-all text-white placeholder:text-neutral-600" 
              type="password" 
              placeholder="Create a password (min. 6 chars)" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
            />
            <button onClick={handleLogin} className="w-full bg-white text-black hover:bg-neutral-200 p-4 rounded-2xl font-bold transition-all shadow-lg active:scale-95">
              Sign In
            </button>
            <button onClick={handleSignup} className="w-full text-neutral-400 p-4 rounded-2xl hover:text-white transition-all text-sm border border-white/5 hover:bg-white/5">
              Create an account
            </button>
          </div>

          {/* User Guidance Note (Naya Section) */}
          <div className="mt-8 pt-6 border-t border-white/5">
            <div className="flex items-start gap-3 bg-blue-500/7 p-4 rounded-2xl border border-blue-500/10">
              <Sparkles size={18} className="text-blue-400 shrink-0 mt-0.5" />
              <div className="text-[12px] leading-relaxed text-neutral-400">
                <p className="text-blue-300 font-bold mb-1 uppercase tracking-wider">How to join:</p>
                <ul className="list-disc ml-4 space-y-1">
                  <li>Enter your <span className="text-white">Email and Password </span>First.</li>
                  
                  <li>Click <span className="text-white">Create an account</span>.</li>
                   <li>Now try to <span className="text-white">Sign In</span>.</li>
                </ul>
              </div>
            </div>
            <p className="text-[10px] text-center text-neutral-600 mt-4 italic">
              Verification ensures your Gmail tokens and Resumes are securely stored.
            </p>
          </div>
          
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#050505] text-neutral-300 font-sans selection:bg-white/20">
      
      {/* Sidebar (Logo and Heading Fixed in one line) */}
      <aside className="w-80 bg-[#0a0a0a] flex flex-col p-6 border-r border-white/5 hidden lg:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-black shadow-lg shrink-0"><Zap size={18} fill="black" /></div>
          <h1 className="font-bold text-lg text-white">Email Copilot</h1>
        </div>

        {/* Primary navigation */}
        <nav className="space-y-1 mb-4">
          {[
            { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
            { key: 'chat', label: 'AI Workspace', icon: Bot },
            { key: 'smartReply', label: 'Smart Reply', icon: Reply },
            { key: 'inbox', label: 'Inbox Summary', icon: Inbox },
          ].map((item) => {
            const Icon = item.icon;
            const active = view === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={`flex items-center gap-3 w-full p-3 rounded-2xl text-sm font-semibold transition-all ${active ? 'bg-white/10 text-white shadow-inner' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`}
              >
                <Icon size={18} /> {item.label}
              </button>
            );
          })}
        </nav>

        {/* Workspace navigation (new pages) */}
        <p className="text-[11px] font-bold text-neutral-600 uppercase tracking-widest px-2 mb-2">Workspace</p>
        <nav className="space-y-1 mb-6">
          {[
            { key: 'analytics', label: 'Analytics', icon: BarChart3 },
            { key: 'calendar', label: 'Calendar', icon: CalendarIcon },
            { key: 'contacts', label: 'Contacts', icon: Users },
            { key: 'notifications', label: 'Notifications', icon: Bell },
          ].map((item) => {
            const Icon = item.icon;
            const active = view === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={`flex items-center gap-3 w-full p-3 rounded-2xl text-sm font-semibold transition-all ${active ? 'bg-white/10 text-white shadow-inner' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`}
              >
                <Icon size={18} /> {item.label}
              </button>
            );
          })}
        </nav>

        <div className="space-y-2 mb-8">
          <button onClick={handleNewSession} className="flex items-center gap-3 p-4 w-full bg-white/5 border border-white/10 text-white rounded-2xl hover:bg-white/10 font-semibold text-sm">
            <Plus size={18} /> New Session
          </button>
          <button onClick={() => setPaletteOpen(true)} className="flex items-center gap-3 p-3 w-full text-neutral-400 hover:bg-white/5 hover:text-white rounded-2xl text-sm font-semibold transition-all">
            <Search size={18} /> Search
            <kbd className="ml-auto text-[10px] font-medium text-neutral-500 border border-white/10 rounded-md px-1.5 py-0.5">⌘K</kbd>
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto">
            <p className="text-[11px] font-bold text-neutral-600 uppercase tracking-widest px-2 mb-4">Recent Conversations</p>
            {conversations.length > 0 ? conversations.map((conv) => (
              <div key={conv.id} onClick={() => openConversation(conv.id)} className={`flex items-center gap-3 p-3 text-sm rounded-2xl cursor-pointer transition-all ${activeConversationId === conv.id ? 'bg-white/10 text-white' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`}>
                <MessageSquare size={16} className="shrink-0" />
                <span className="flex-1 min-w-0 truncate">{conv.title}</span>
              </div>
            )) : <p className="text-xs text-neutral-700 px-3 italic">No conversations yet...</p>}
        </div>

        <div className="mt-auto pt-6 border-t border-white/5 space-y-2">
           <button onClick={() => setView('settings')} className={`flex items-center gap-3 w-full p-3 rounded-2xl text-sm transition-all ${view === 'settings' ? 'bg-white/10 text-white' : 'hover:bg-white/5'}`}><SettingsIcon size={18} /> Settings</button>
           <button onClick={() => setView('profile')} className={`flex items-center gap-3 w-full p-3 rounded-2xl text-sm transition-all ${view === 'profile' ? 'bg-white/10 text-white' : 'hover:bg-white/5'}`}><User size={18} /> Profile</button>
           <button onClick={handleGoogleLogin} className="flex items-center gap-3 w-full p-3 hover:bg-white/5 rounded-2xl text-sm transition-all"><Mail size={18} /> Link Gmail Account</button>
           <label className="flex items-center gap-3 w-full p-3 hover:bg-white/5 rounded-2xl text-sm cursor-pointer">
              <FileUp size={18} /> {uploading ? "Parsing..." : "Upload Resume"}
              <input type="file" className="hidden" onChange={handleFileUpload} accept=".pdf" />
           </label>
           <button onClick={handleLogout} className="flex items-center gap-3 w-full p-3 hover:bg-red-500/10 rounded-2xl text-sm text-red-400 mt-4"><LogOut size={18}/> Logout</button>
        </div>
      </aside>

      {/* Main Interface (Dashboard / Smart Reply / Inbox / Chat) */}
      <main className="flex-1 flex flex-col relative bg-[#050505] overflow-hidden min-h-0 min-w-0">
        {view === 'chat' ? (
        <>
        <header className="p-5 border-b border-white/5 bg-[#050505]/80 backdrop-blur-md flex justify-between items-center px-10">
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><Bot size={16} className="text-blue-500" />AI Workspace</div>
            <div className="text-[11px] font-medium text-neutral-500 bg-white/5 px-4 py-2 rounded-full">Active: {user.email}</div>
        </header>

        {/* Message area (Full chat history loads here) */}
        <div className="flex-1 overflow-y-auto px-6 py-10 md:px-24 space-y-8 scroll-smooth">
          {chat.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto opacity-50">
               <div className="w-20 h-20 bg-[#111] rounded-3xl flex items-center justify-center text-white mb-8 border border-white/5 shadow-2xl"><Bot size={40} /></div>
               <h2 className="text-3xl font-bold text-white mb-4 tracking-tight">How can I help you?</h2>
               <p className="text-neutral-500 leading-relaxed text-sm">I can help you with emails, cover letters, and professional communication based on your profile.</p>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-10">
              {chat.map((msg, index) => (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={index} className={`flex gap-6 ${msg.role === 'assistant' ? 'bg-white/[0.03] p-8 rounded-[2.5rem] border border-white/5 shadow-inner' : ''}`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-lg ${msg.role === 'user' ? 'bg-white text-black' : 'bg-neutral-800 text-white'}`}>
                    {msg.role === 'user' ? <User size={20} /> : <Bot size={20} />}
                  </div>
                  <div className="flex-1">
                    <p className="text-neutral-200 leading-relaxed text-[15px] font-medium whitespace-pre-wrap">{msg.text}</p>
                    {msg.status === 'ready' && (
                       <button onClick={() => handleSendEmail(msg.metadata?.subject, msg.text)} className="mt-6 flex items-center gap-2 bg-white hover:bg-neutral-200 text-black px-6 py-2.5 rounded-2xl text-xs font-bold transition-all shadow-xl active:scale-95">
                         <Send size={14} /> Send via Gmail
                       </button>
                    )}
                  </div>
                </motion.div>
              ))}
              {loading && <div className="flex gap-3 items-center text-white/50 text-xs font-medium animate-pulse px-4"><Moon size={14} className="animate-spin" /> Neural processing...</div>}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="p-8 bg-gradient-to-t from-[#050505] to-transparent">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center bg-[#111] border border-white/10 rounded-[2rem] p-2 pr-3 focus-within:border-white/30 transition-all shadow-2xl">
              <input 
                className="flex-1 bg-transparent p-4 outline-none text-white placeholder:text-neutral-600 text-base"
                placeholder="Message Secretary..." 
                value={message} 
                onChange={e => setMessage(e.target.value)} 
                onKeyPress={e => e.key === 'Enter' && handleSendMessage()} 
              />
              <button onClick={handleSendMessage} className="p-4 bg-white text-black hover:bg-neutral-200 rounded-[1.5rem] transition-all shadow-lg active:scale-95">
                <Send size={20} />
              </button>
            </div>
            <p className="text-[10px] text-center text-neutral-700 mt-4 font-medium uppercase tracking-widest">Powered by Mistral AI v1.5</p>
          </div>
        </div>
        </>
        ) : (
          <CopilotView
            view={view}
            user={{ id: user.id, email: user.email }}
            onNavigate={setView}
            onCompose={() => handleSendEmail('', '')}
            onSendDraft={handleSendEmail}
            onLinkGmail={handleGoogleLogin}
            onLogout={handleLogout}
            openToolAction={pendingTool}
            onToolHandled={() => setPendingTool(null)}
          />
        )}
        {/* Onboarding Popup Modal */}
<AnimatePresence>
  {showOnboarding && (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="bg-[#111] border border-white/10 p-8 rounded-[2.5rem] max-w-md w-full shadow-2xl shadow-blue-500/10 text-center"
      >
        <div className="flex justify-center mb-6 text-blue-500">
          <Bot size={48} />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Complete Your Setup</h2>
        <p className="text-neutral-400 text-sm mb-8 leading-relaxed">
          To unlock the full potential of your Smart Email Agent, please link your Gmail and upload your resume.
        </p>

        <div className="space-y-3">
          {/* Link Gmail Action */}
          <button 
            onClick={() => { handleGoogleLogin(); setShowOnboarding(false); }}
            className="w-full flex items-center justify-center gap-3 bg-white text-black p-4 rounded-2xl font-bold hover:bg-neutral-200 transition-all"
          >
            <Mail size={18} /> Link Gmail Account
          </button>

          {/* Resume Upload Action (Input trigger) */}
          <label className="w-full flex items-center justify-center gap-3 border border-white/10 text-white p-4 rounded-2xl font-bold hover:bg-white/5 transition-all cursor-pointer">
            <FileUp size={18} /> Upload Your Resume
            <input type="file" className="hidden" onChange={(e) => { handleFileUpload(e); setShowOnboarding(false); }} accept=".pdf" />
          </label>

          <button 
            onClick={() => setShowOnboarding(false)}
            className="w-full text-neutral-600 text-xs font-medium uppercase tracking-widest pt-4 hover:text-neutral-400 transition-colors"
          >
            Skip for now
          </button>
        </div>
      </motion.div>
    </div>
  )}
</AnimatePresence>

      {/* Compose / Send Email Modal */}
      {showCompose && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-[#111] border border-white/10 p-8 rounded-[2.5rem] max-w-lg w-full shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white tracking-tight">Send Email</h2>
              <button onClick={() => setShowCompose(false)} className="text-neutral-500 hover:text-white text-lg leading-none">✕</button>
            </div>

            <div className="space-y-4">
              <input
                className="w-full p-3 bg-white/5 border border-white/10 rounded-2xl outline-none focus:bg-white/10 text-white placeholder:text-neutral-600 text-sm"
                placeholder="Recipient email"
                value={composeTo}
                onChange={e => setComposeTo(e.target.value)}
              />
              <input
                className="w-full p-3 bg-white/5 border border-white/10 rounded-2xl outline-none focus:bg-white/10 text-white placeholder:text-neutral-600 text-sm"
                placeholder="Subject"
                value={composeSubject}
                onChange={e => setComposeSubject(e.target.value)}
              />
              <textarea
                rows={8}
                className="w-full p-3 bg-white/5 border border-white/10 rounded-2xl outline-none focus:bg-white/10 text-white placeholder:text-neutral-600 text-sm resize-none"
                placeholder="Email body"
                value={composeBody}
                onChange={e => setComposeBody(e.target.value)}
              />

              {/* Resume attachment toggle */}
              <label className="flex items-center gap-3 text-sm text-neutral-300 cursor-pointer select-none">
                <input type="checkbox" checked={composeAttachResume} onChange={e => setComposeAttachResume(e.target.checked)} />
                Attach my resume (PDF)
              </label>

              {/* Any-file attachment */}
              <label className="flex items-center gap-3 w-full p-3 bg-white/5 border border-white/10 rounded-2xl text-sm cursor-pointer hover:bg-white/10 text-neutral-300 truncate">
                <FileUp size={18} className="shrink-0" />
                <span className="truncate">{composeFile ? composeFile.name : "Attach a file"}</span>
                <input type="file" className="hidden" onChange={e => setComposeFile(e.target.files[0] || null)} />
              </label>
              {composeFile && (
                <button onClick={() => setComposeFile(null)} className="text-xs text-red-400 hover:text-red-300">Remove attachment</button>
              )}
            </div>

            <button
              onClick={submitEmail}
              disabled={sending}
              className="mt-6 w-full flex items-center justify-center gap-2 bg-white text-black p-4 rounded-2xl font-bold hover:bg-neutral-200 transition-all disabled:opacity-50 active:scale-95"
            >
              <Send size={16} /> {sending ? "Sending..." : "Send Email"}
            </button>
          </div>
        </div>
      )}
      </main>

      {/* Global command palette (⌘K) + floating quick actions */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={setView}
        onCompose={() => handleSendEmail('', '')}
        onOpenTool={handleOpenTool}
        onLinkGmail={handleGoogleLogin}
        onLogout={handleLogout}
      />
      {view !== 'chat' && (
        <QuickActionFab
          onCompose={() => handleSendEmail('', '')}
          onNavigate={setView}
          onOpenTool={handleOpenTool}
          onOpenPalette={() => setPaletteOpen(true)}
        />
      )}
    </div>
  );
}

export default App;