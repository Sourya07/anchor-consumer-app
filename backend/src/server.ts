import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// Simple in-memory session store (Nonce challenges)
const challenges = new Map<string, string>();

// Auth Flow 1: Request Challenge
app.get('/api/auth/challenge', (req, res) => {
  const { pubkey } = req.query;
  if (!pubkey || typeof pubkey !== 'string') {
    return res.status(400).json({ error: 'Missing pubkey' });
  }

  const nonce = crypto.randomBytes(32).toString('hex');
  const message = `Sign this message to authenticate with Sovereign AI.\nNonce: ${nonce}`;
  
  challenges.set(pubkey, message);
  res.json({ message });
});

// Auth Flow 2: Verify Signature & Return Session Token (Mocked as just returning success for now)
app.post('/api/auth/login', async (req, res) => {
  const { pubkey, signature } = req.body;
  if (!pubkey || !signature) {
    return res.status(400).json({ error: 'Missing pubkey or signature' });
  }

  const message = challenges.get(pubkey);
  if (!message) {
    return res.status(400).json({ error: 'No challenge found or expired' });
  }

  try {
    const verified = nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      bs58.decode(signature),
      bs58.decode(pubkey)
    );

    if (!verified) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    challenges.delete(pubkey);

    // Ensure user exists in DB
    await prisma.user.upsert({
      where: { id: pubkey },
      update: {},
      create: { id: pubkey }
    });

    res.json({ token: pubkey }); // In production, issue a real JWT token here
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Mock LLM and Embeddings to prevent requiring real OpenAI API key for basic execution
async function mockEmbedding(text: string) {
  // Returns a fake 1536 dim vector
  return Array.from({ length: 1536 }, () => Math.random());
}

async function mockChatCompletion(context: string, prompt: string) {
  return `This is a simulated AI response. You asked: "${prompt}". I found ${context ? 'some' : 'no'} context.`;
}

app.post('/api/chat', async (req, res) => {
  const { token, prompt } = req.body;
  if (!token || !prompt) {
    return res.status(401).json({ error: 'Unauthorized or missing prompt' });
  }

  try {
    const embedding = await mockEmbedding(prompt);

    // Context retrieval
    // Note: Since pgvector isn't fully set up without a real DB, we mock the retrieval.
    // In real app:
    // const similarMemories = await prisma.$queryRaw`SELECT content FROM "Memory" WHERE "userId" = ${token} ORDER BY embedding <-> ${JSON.stringify(embedding)}::vector LIMIT 5`;
    const similarMemories: any[] = []; 
    
    const contextStr = similarMemories.map(m => m.content).join('\n');
    const aiResponse = await mockChatCompletion(contextStr, prompt);

    // Save prompt and response as memories
    await prisma.$executeRaw`
      INSERT INTO "Memory" (id, content, embedding, "userId", "createdAt")
      VALUES (gen_random_uuid(), ${prompt}, ${JSON.stringify(embedding)}::vector, ${token}, now())
    `;

    res.json({ response: aiResponse });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const memories = await prisma.memory.findMany({
      where: { userId: token },
      orderBy: { createdAt: 'asc' },
      select: { content: true }
    });

    // Hash all memories together to create a simple merkle root substitute for demo
    const hash = crypto.createHash('sha256');
    for (const mem of memories) {
      hash.update(mem.content);
    }
    const stateRoot = hash.digest('hex');

    // In a real app, you'd construct the Solana transaction here, sign as fee payer, and return it.
    // The frontend then finishes signing with the user's wallet and submits it.

    res.json({ 
      stateRoot,
      message: 'State hash generated successfully. Next, submit this to Solana UpdateState instruction.' 
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
