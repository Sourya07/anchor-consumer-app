import { useMemo, useState, useEffect } from 'react';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import { Send, Cpu, Link as LinkIcon, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import bs58 from 'bs58';
import axios from 'axios';

// Default styles that can be overridden by your app
import '@solana/wallet-adapter-react-ui/styles.css';

const BACKEND_URL = 'http://localhost:3001/api';

function ChatInterface() {
  const { publicKey, signMessage } = useWallet();
  const [messages, setMessages] = useState<{role: 'user' | 'ai', content: string}[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('');

  // Auto-login when wallet connects
  useEffect(() => {
    if (publicKey && signMessage && !sessionToken) {
      login();
    }
  }, [publicKey, signMessage]);

  const login = async () => {
    if (!publicKey || !signMessage) return;
    try {
      const pubkeyStr = publicKey.toBase58();
      // 1. Get Challenge
      const challengeRes = await axios.get(`${BACKEND_URL}/auth/challenge?pubkey=${pubkeyStr}`);
      const message = challengeRes.data.message;
      
      // 2. Sign Challenge
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signature);
      
      // 3. Authenticate
      const authRes = await axios.post(`${BACKEND_URL}/auth/login`, {
        pubkey: pubkeyStr,
        signature: signatureBase58
      });
      
      setSessionToken(authRes.data.token);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !sessionToken) return;

    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInput('');
    setLoading(true);

    try {
      const res = await axios.post(`${BACKEND_URL}/chat`, {
        token: sessionToken,
        prompt: userMsg
      });
      setMessages(prev => [...prev, { role: 'ai', content: res.data.response }]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages(prev => [...prev, { role: 'ai', content: "Error communicating with Sovereign AI." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    if (!sessionToken) return;
    setSyncStatus('Calculating State Root...');
    try {
      const res = await axios.post(`${BACKEND_URL}/sync`, { token: sessionToken });
      setSyncStatus(`Ready. Root: ${res.data.stateRoot.substring(0, 16)}...`);
      // Future: Prompts phantom to sign UpdateState transaction
    } catch (error) {
      console.error("Sync error:", error);
      setSyncStatus('Sync Failed');
    }
  };

  if (!publicKey) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 h-full opacity-70">
        <Cpu className="w-24 h-24 mb-6 text-slate-600" />
        <h2 className="text-2xl font-light text-slate-300">Connect Wallet to Access Your AI</h2>
      </div>
    );
  }

  if (!sessionToken) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mb-4"></div>
        <p className="text-slate-400">Authenticating with Identity...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-800/50 rounded-2xl border border-slate-700 overflow-hidden shadow-2xl backdrop-blur-sm">
      <div className="flex justify-between items-center p-4 border-b border-slate-700 bg-slate-800/80">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.8)]"></div>
          <span className="font-semibold text-slate-200">blockhashers</span>
        </div>
        <button 
          onClick={handleSync}
          className="flex items-center space-x-2 px-3 py-1.5 text-xs font-medium bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg transition-colors border border-blue-500/30"
        >
          <LinkIcon className="w-3.5 h-3.5" />
          <span>Sync State to Chain</span>
        </button>
      </div>
      
      {syncStatus && (
        <div className="bg-slate-700/50 px-4 py-2 text-xs text-slate-300 flex items-center space-x-2 border-b border-slate-700 font-mono">
          <AlertCircle className="w-3.5 h-3.5 text-blue-400" />
          <span>{syncStatus}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-500 mt-10">
            Send a message to start training your sovereign AI.
          </div>
        )}
        <AnimatePresence>
          {messages.map((msg, i) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={i}
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                msg.role === 'user' 
                  ? 'bg-blue-600 text-white ml-auto rounded-tr-sm' 
                  : 'bg-slate-700 text-slate-200 mr-auto rounded-tl-sm'
              }`}
            >
              {msg.content}
            </motion.div>
          ))}
          {loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-slate-700 text-slate-200 mr-auto rounded-2xl rounded-tl-sm px-4 py-3 w-16 flex items-center justify-center space-x-1">
              <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div>
              <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="p-4 bg-slate-800/80 border-t border-slate-700">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex relative items-center"
        >
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Talk to your AI..."
            className="w-full bg-slate-900 border border-slate-700 rounded-full px-5 py-3 text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all pr-12"
          />
          <button 
            type="submit" 
            disabled={!input.trim() || loading}
            className="absolute right-2 p-2 bg-blue-600 rounded-full text-white hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
          >
            <Send className="w-4 h-4 ml-0.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

function App() {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [network]
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div className="min-h-screen bg-slate-900 text-slate-50 flex flex-col items-center">
            
            {/* Header */}
            <header className="w-full max-w-5xl mx-auto p-6 flex justify-between items-center z-10">
              <div className="flex items-center space-x-3">
                <div className="bg-blue-600 p-2 rounded-xl">
                  <Cpu className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                    Sovereign AI
                  </h1>
                  <p className="text-xs text-slate-400">Off-Chain Intelligence, On-Chain Soul</p>
                </div>
              </div>
              <WalletMultiButton className="!bg-slate-800 hover:!bg-slate-700 !rounded-xl !border !border-slate-700 !transition-colors" />
            </header>

            {/* Main Content */}
            <main className="flex-1 w-full max-w-5xl mx-auto p-4 md:p-6 flex flex-col md:flex-row gap-8 pb-12">
              
              {/* Left Column - Info */}
              <div className="md:w-1/3 flex flex-col justify-center space-y-6">
                <div>
                  <h2 className="text-3xl lg:text-4xl font-semibold mb-4 text-slate-100">Own Your AI's Brain.</h2>
                  <p className="text-slate-400 leading-relaxed">
                    Generic AI wrappers trap your data. Sovereign AI runs inference at Web2 speeds while cryptographically anchoring your AI's memory state root to Solana.
                  </p>
                </div>
                
                <div className="space-y-4">
                  <div className="p-4 bg-slate-800/50 rounded-2xl border border-slate-700/50">
                    <h3 className="text-sm font-semibold text-blue-400 mb-1">High-Speed Inference</h3>
                    <p className="text-xs text-slate-400">pgvector + Node.js backend processes chat instantly.</p>
                  </div>
                  <div className="p-4 bg-slate-800/50 rounded-2xl border border-slate-700/50">
                    <h3 className="text-sm font-semibold text-indigo-400 mb-1">On-Chain State Proof</h3>
                    <p className="text-xs text-slate-400">Merkle root of all memories is anchored to your PDA.</p>
                  </div>
                  <div className="p-4 bg-slate-800/50 rounded-2xl border border-slate-700/50">
                    <h3 className="text-sm font-semibold text-purple-400 mb-1">True Ownership</h3>
                    <p className="text-xs text-slate-400">If our servers die, your PDA proves ownership of the state backup.</p>
                  </div>
                </div>
              </div>

              {/* Right Column - Chat App */}
              <div className="md:w-2/3 h-[600px] flex flex-col">
                <ChatInterface />
              </div>
            </main>

            {/* Background Decorations */}
            <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
              <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full"></div>
              <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/20 blur-[120px] rounded-full"></div>
            </div>

          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export default App;
