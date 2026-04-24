import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import * as cheerio from 'cheerio';
import cors from 'cors';

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

  // API Routes
  
  // Store chunks from frontend
  app.post('/api/store-chunks', (req, res) => {
    const { source, chunks } = req.body;
    if (!source || !chunks) return res.status(400).json({ error: 'Missing data' });
    
    // Add source property to each chunk if not present
    const normalizedChunks = chunks.map((c: any) => ({ ...c, source }));
    vectorStore.push(...normalizedChunks);
    res.json({ message: 'Success', count: chunks.length });
  });

  // Scrape URL (Backend needed due to CORS)
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

  // Search vector store
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

  // Search by keyword (fallback/utility)
  app.post('/api/search', (req, res) => {
    const { query } = req.body;
    const lowerQuery = query.toLowerCase();
    const results = vectorStore
      .filter(c => c.text.toLowerCase().includes(lowerQuery) || c.source.toLowerCase().includes(lowerQuery))
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
