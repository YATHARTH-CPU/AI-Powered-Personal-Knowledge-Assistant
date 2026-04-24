import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import * as cheerio from 'cheerio';
import cors from 'cors';
import { GoogleGenAI } from "@google/genai";

let aiClient: GoogleGenAI | null = null;
function getAI() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not defined');
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '100mb' }));

  // In-memory "vector store"
  interface Chunk {
    id: string;
    text: string;
    source: string;
    embedding: number[];
  }
  let vectorStore: Chunk[] = [];

  // --- AI API Proxies ---

  app.post('/api/ai/extract-pdf', async (req, res) => {
    try {
      const { base64 } = req.body;
      const ai = getAI();
      
      const result = await (ai as any).models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: 'user',
            parts: [
              { text: "Extract and return the full text content from this PDF. Output ONLY the extracted text, no commentary." },
              { inlineData: { data: base64, mimeType: "application/pdf" } }
            ]
          }
        ]
      });
      
      res.json({ text: result.text });
    } catch (e: any) {
      console.error('PDF Extraction Error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/ai/embed', async (req, res) => {
    try {
      const { text, batch } = req.body;
      const ai = getAI();
      
      const result = await (ai as any).models.embedContent({
        model: "gemini-embedding-2-preview",
        contents: Array.isArray(text) ? text : [text]
      });
      
      if (batch && Array.isArray(text)) {
        res.json({ embeddings: result.embeddings });
      } else {
        res.json({ embedding: result.embeddings[0] });
      }
    } catch (e: any) {
      console.error('Embedding Error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/ai/chat', async (req, res) => {
    try {
      const { prompt } = req.body;
      const ai = getAI();
      
      const result = await (ai as any).models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      res.json({ text: result.text });
    } catch (e: any) {
      console.error('Chat Error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // --- Knowledge Store Routes ---
  
  app.post('/api/store-chunks', (req, res) => {
    const { source, chunks } = req.body;
    if (!source || !chunks) return res.status(400).json({ error: 'Missing data' });
    
    const normalizedChunks = chunks.map((c: any) => ({ ...c, source }));
    vectorStore.push(...normalizedChunks);
    res.json({ message: 'Success', count: chunks.length });
  });

  app.post('/api/scrape', async (req, res) => {
    try {
      const { url } = req.body;
      const response = await fetch(url);
      const html = await response.text();
      const $ = cheerio.load(html);
      
      $('script, style, nav, footer, iframe').remove();
      const text = $('body').text().replace(/\s+/g, ' ').trim();
      
      res.json({ text });
    } catch (e) {
      res.status(500).json({ error: 'Scrape failed' });
    }
  });

  app.post('/api/search-vector', (req, res) => {
    const { embedding } = req.body;
    if (!embedding) return res.status(400).json({ error: 'Missing embedding' });

    const results = vectorStore
      .map(chunk => ({
        ...chunk,
        similarity: cosineSimilarity(embedding, chunk.embedding)
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    res.json({ results });
  });

  app.get('/api/documents', (req, res) => {
    const sources = Array.from(new Set(vectorStore.map(c => c.source)));
    res.json({ sources });
  });

  app.post('/api/clear-docs', (req, res) => {
    vectorStore = [];
    res.json({ message: 'Cleared' });
  });

  // Vite + Static Serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

startServer();