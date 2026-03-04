import { useMemo, useState, useEffect } from 'react';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl, PublicKey } from '@solana/web3.js';
import * as web3 from '@solana/web3.js';
import { Send, Cpu, Link as LinkIcon, AlertCircle, Search, Menu, UserCircle, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import bs58 from 'bs58';
import axios from 'axios';

// Default styles that can be overridden by your app
import '@solana/wallet-adapter-react-ui/styles.css';

const BACKEND_URL = 'http://localhost:3001/api';

function ChatInterface() {
  const { publicKey, signMessage, signTransaction } = useWallet();
  const [messages, setMessages] = useState<{role: 'user' | 'ai', content: string}[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (txSignature) {
      navigator.clipboard.writeText(txSignature);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

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
    if (!sessionToken || !publicKey || !signTransaction) return;
    setTxSignature(null);
    setSyncStatus('Calculating State Root on Backend...');
    try {
      // 1. Get the state root from the backend
      const res = await axios.post(`${BACKEND_URL}/sync`, { token: sessionToken });
      const stateRootHex = res.data.stateRoot;
      setSyncStatus(`Backend generated root: ${stateRootHex.substring(0, 16)}...`);

      // 2. Prepare the Solana Transaction
      setSyncStatus('Please approve the transaction in your wallet...');
      
      const PROGRAM_ID = new PublicKey('3Dt3BQ2YmiCy6cwqYV8en1i1ES7GduUHsFd6QNmRPNev');
      
      // Derive the PDA
      const [pdaAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from("sovereign_ai"), publicKey.toBuffer()],
        PROGRAM_ID
      );

      // Convert the hex string state root to a 32-byte array
      const stateRootBytes = Buffer.from(stateRootHex, 'hex');

      // Construct the instruction data. 
      // Anchor discriminator for `update_state` from IDL: [135, 112, 215, 75, 247, 185, 53, 176]
      const updateDiscriminator = Buffer.from([135, 112, 215, 75, 247, 185, 53, 176]);
      const instructionData = Buffer.concat([updateDiscriminator, stateRootBytes]);

      // Fetch recent blockhash and connection
      const connection = new web3.Connection("http://127.0.0.1:8899", 'confirmed');
      
      const transaction = new web3.Transaction();

      // Check if the PDA exists yet. If not, we need to initialize it first!
      const pdaAccountInfo = await connection.getAccountInfo(pdaAddress);
      if (!pdaAccountInfo) {
        console.log("PDA not found. Initializing...");
        setSyncStatus('Initializing on-chain account for the first time...');
        const initDiscriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
        const initInstruction = new web3.TransactionInstruction({
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: pdaAddress, isSigner: false, isWritable: true },
            { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          programId: PROGRAM_ID,
          data: initDiscriminator,
        });
        transaction.add(initInstruction);
      }

      // Create the update instruction
      const updateInstruction = new web3.TransactionInstruction({
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: pdaAddress, isSigner: false, isWritable: true },
        ],
        programId: PROGRAM_ID,
        data: instructionData,
      });
      transaction.add(updateInstruction);

      // Fetch recent blockhash
      const latestBlockhash = await connection.getLatestBlockhash();
      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = publicKey;

      let signatureString = "";
      
      // Attempt to sign and send
      const signedTransaction = await signTransaction(transaction);
      signatureString = await connection.sendRawTransaction(signedTransaction.serialize(), {
         skipPreflight: false,
         preflightCommitment: "confirmed"
      });
      
      console.log(`Transaction Signature: ${signatureString}`);
      setTxSignature(signatureString);
      setSyncStatus(`Success!`);

    } catch (error: any) {
       console.error("Sync error:", error);
       setSyncStatus(`Sync Failed: ${error.message || 'Transaction rejected'}`);
    }
  };

  if (!publicKey) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 h-full px-8 py-16 bg-[#262b2f] rounded-xl border border-gray-800">
        <Cpu className="w-20 h-20 mb-6 text-gray-500" />
        <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
        <p className="text-gray-400 text-center text-sm max-w-xs">
          Connect your Solana wallet to unlock your personalized AI experience and view your sovereign data.
        </p>
      </div>
    );
  }

  if (!sessionToken) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 h-full border border-gray-800 rounded-xl bg-[#262b2f]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#2081E2] mb-4"></div>
        <p className="text-gray-400 font-medium">Authenticating identity...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#353840] rounded-xl border border-gray-700 overflow-hidden shadow-xl hover:shadow-[#2081E2]/10 transition-shadow duration-300">
      
      {/* Opensea Style Card Header */}
      <div className="flex flex-col border-b border-gray-700 p-4 bg-[#262b2f]">
         <div className="flex justify-between items-center w-full">
            <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#2081E2] to-purple-500 overflow-hidden border-2 border-gray-800 shrink-0">
                   {/* Avatar Placeholder */}
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-semibold text-[#8a939b] uppercase tracking-wider">Collection</span>
                  <span className="text-sm font-semibold text-white truncate max-w-[150px]">
                     blockhashers AI
                  </span>
                </div>
            </div>
            <button 
                onClick={handleSync}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold bg-[#2081E2] text-white hover:bg-[#1868b7] rounded-lg transition-colors shadow-sm"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                <span>Anchor Data</span>
             </button>
         </div>
         {syncStatus && (
           <div className="mt-3 px-3 py-2 bg-[#121212]/50 text-xs text-[#8a939b] rounded-lg flex items-center justify-between font-mono">
              <div className="flex items-center space-x-2 overflow-hidden">
                <AlertCircle className="w-3.5 h-3.5 text-[#2081E2] shrink-0" />
                <span className="truncate">{syncStatus} {txSignature && <span className="text-white ml-1">{txSignature}</span>}</span>
              </div>
              {txSignature && (
                <button 
                  onClick={handleCopy}
                  className="ml-2 p-1.5 hover:bg-[#262b2f] rounded-md transition-colors shrink-0 text-[#8a939b] hover:text-white"
                  title="Copy Transaction ID"
                >
                  {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              )}
           </div>
         )}
      </div>
      
      {/* Chat History */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-[#353840]">
        {messages.length === 0 && (
          <div className="text-center text-[#8a939b] mt-10 text-sm">
            No transaction history found. Send a message to mint your first memory.
          </div>
        )}
        <AnimatePresence>
          {messages.map((msg, i) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={i}
              className={`max-w-[85%] rounded-2xl px-5 py-3 text-[15px] leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-[#2081E2] text-white ml-auto rounded-tr-sm shadow-md' 
                  : 'bg-[#262b2f] text-[#e5e8eb] border border-gray-700 mr-auto rounded-tl-sm'
              }`}
            >
              {msg.content}
            </motion.div>
          ))}
          {loading && (
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-[#262b2f] border border-gray-700 text-[#e5e8eb] mr-auto rounded-2xl rounded-tl-sm px-5 py-4 w-20 flex items-center justify-center space-x-1.5 shadow-sm">
              <div className="w-2 h-2 bg-[#8a939b] rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-[#8a939b] rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-2 h-2 bg-[#8a939b] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Input Form */}
      <div className="p-4 bg-[#262b2f] border-t border-gray-700">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex relative items-center"
        >
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Initialize AI computation..."
            className="w-full bg-[#121212] border border-gray-700 rounded-xl px-5 py-3.5 text-[#e5e8eb] placeholder-[#8a939b] focus:outline-none focus:border-[#2081E2] focus:ring-1 focus:ring-[#2081E2] transition-colors pr-14 shadow-sm"
          />
          <button 
            type="submit" 
            disabled={!input.trim() || loading}
            className="absolute right-2 p-2 bg-[#2081E2] rounded-lg text-white hover:bg-[#1868b7] disabled:opacity-40 disabled:hover:bg-[#2081E2] transition-colors"
          >
            <Send className="w-4 h-4" />
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
          {/* Main App Container - OpenSea Dark Background */}
          <div className="min-h-screen bg-[#121212] font-sans text-white">
            
            {/* Nav Header */}
            <header className="sticky top-0 z-50 w-full bg-[#121212] border-b border-[#262b2f] shadow-sm">
              <div className="max-w-[1400px] mx-auto px-4 lg:px-6 h-[72px] flex items-center justify-between">
                
                {/* Logo Area */}
                <div className="flex items-center space-x-3 shrink-0 cursor-pointer">
                   <div className="bg-[#2081E2] p-2 rounded-xl shadow-lg">
                      <Cpu className="w-6 h-6 text-white" />
                   </div>
                   <span className="text-xl font-bold tracking-tight text-white hidden md:block">
                     blockhashers
                   </span>
                </div>

                {/* Global Search Bar (Visual) */}
                <div className="hidden lg:flex max-w-[500px] w-full mx-6 relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                     <Search className="h-5 w-5 text-[#8a939b]" />
                  </div>
                  <input 
                    type="text" 
                    placeholder="Search collections under AI control..." 
                    className="w-full bg-[#202225] text-white border border-[#353840] rounded-xl py-2 pl-10 pr-3 focus:outline-none focus:border-[#4c505c] focus:ring-0 placeholder-[#8a939b] transition-colors"
                    disabled
                  />
                </div>

                {/* Right Nav Actions */}
                <div className="flex items-center space-x-4 ml-auto">
                   <div className="hidden md:flex space-x-6 text-[15px] font-semibold text-[#e5e8eb]">
                     <a href="#" className="hover:text-white transition-colors">Explore</a>
                     <a href="#" className="hover:text-white transition-colors">Drops</a>
                     <a href="#" className="hover:text-white transition-colors">Stats</a>
                   </div>
                   
                   {/* Wallet Connect Override */}
                   <div className="ml-2">
                     <WalletMultiButton className="!bg-[#2081E2] hover:!bg-[#1868b7] !h-10 !px-4 !rounded-xl !text-[15px] !font-semibold !transition-colors !duration-200" />
                   </div>

                   <button className="p-2 text-[#8a939b] hover:text-white hidden lg:block">
                     <UserCircle className="w-7 h-7" />
                   </button>
                   <button className="lg:hidden p-2 text-white">
                     <Menu className="w-6 h-6" />
                   </button>
                </div>
              </div>
            </header>

            {/* Main Content Area */}
            <main className="max-w-[1400px] mx-auto px-4 lg:px-8 pt-12 pb-24">
              
              {/* Hero Flex Container */}
              <div className="flex flex-col lg:flex-row items-center justify-between gap-12 lg:gap-16">
                
                {/* Left Side: Hero Strategy & Copy */}
                <div className="lg:w-1/2 flex flex-col items-center text-center lg:items-start lg:text-left pt-8">
                   <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-[#ffffff] tracking-tight leading-[1.1] mb-6 whitespace-pre-line">
                     Discover, collect, and train extraordinary AI.
                   </h1>
                   <p className="text-lg md:text-xl text-[#8a939b] font-medium leading-relaxed max-w-xl mb-10">
                     Sovereign AI is the world's first and largest decentralized protocol for anchoring intelligent models and owning memory states on Solana.
                   </p>
                   
                   {/* Action Buttons */}
                   <div className="flex items-center gap-4 w-full justify-center lg:justify-start">
                     <button className="flex-1 lg:flex-none px-8 py-3.5 bg-[#2081E2] text-white text-[16px] font-semibold rounded-xl hover:bg-[#1868b7] transition-colors w-full sm:w-auto text-center shadow-lg">
                        Explore Models
                     </button>
                     <button className="flex-1 lg:flex-none px-8 py-3.5 bg-[#202225] border border-[#353840] text-white text-[16px] font-semibold rounded-xl hover:bg-[#353840] transition-colors w-full sm:w-auto text-center">
                        Create AI
                     </button>
                   </div>
                   
                   {/* Stats Grid */}
                   <div className="grid grid-cols-3 gap-8 mt-16 w-full max-w-lg">
                      <div className="flex flex-col">
                        <span className="text-2xl font-bold text-white">100K+</span>
                        <span className="text-[15px] text-[#8a939b]">Memories</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-2xl font-bold text-white">2.5M</span>
                        <span className="text-[15px] text-[#8a939b]">Volume (SOL)</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-2xl font-bold text-white">40K+</span>
                        <span className="text-[15px] text-[#8a939b]">Creators</span>
                      </div>
                   </div>
                </div>

                {/* Right Side: The Featured "Asset" (Chat Card) */}
                <div className="w-full lg:w-1/2 max-w-2xl">
                   {/* Wrapping the ChatInterface in an NFT-style Spotlight Card */}
                   <div className="rounded-2xl overflow-hidden bg-[#262b2f] border border-[#353840] shadow-2xl transition-transform hover:-translate-y-1 duration-300">
                      
                      {/* Image/Preview Banner Area (Top Half of Card) */}
                      <div className="h-40 w-full relative bg-gradient-to-r from-blue-900 to-[#121212] overflow-hidden">
                         <div className="absolute inset-0 opacity-20">
                           <div className="absolute -inset-x-20 -inset-y-20 rotate-45 bg-[#2081E2] blur-[100px] rounded-full mix-blend-color-dodge"></div>
                         </div>
                         <div className="absolute bottom-4 left-4 z-10 flex items-center space-x-2">
                           <div className="bg-[#121212]/80 backdrop-blur-md px-3 py-1 rounded-md border border-white/10 flex items-center">
                              <span className="w-2 h-2 rounded-full bg-green-500 mr-2 shadow-[0_0_8px_#22c55e]"></span>
                              <span className="text-xs font-semibold uppercase tracking-wider text-white">Live Node</span>
                           </div>
                         </div>
                      </div>

                      {/* The Chat Application inside the card */}
                      <div className="h-[520px] relative">
                         <ChatInterface />
                      </div>
                   </div>
                </div>

              </div>
              
              {/* Footer Section Placeholder */}
              <div className="mt-32 pt-16 border-t border-[#262b2f] flex flex-col md:flex-row justify-between items-center text-[#8a939b] text-sm font-semibold">
                <span>© 2026 blockhashers, Inc</span>
                <div className="flex space-x-6 mt-4 md:mt-0">
                  <a className="hover:text-white transition-colors" href="#">Privacy Policy</a>
                  <a className="hover:text-white transition-colors" href="#">Terms of Service</a>
                </div>
              </div>

            </main>
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export default App;
