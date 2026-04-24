/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Send, 
  FileText, 
  Globe, 
  StickyNote, 
  Trash2, 
  Loader2, 
  BookOpen,
  MessageSquare,
  Search,
  ChevronRight,
  ListRestart
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  source?: string[];
}

interface Source {
  name: string;
  type: 'pdf' | 'url' | 'note';
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [uploadMode, setUploadMode] = useState<'none' | 'pdf' | 'url' | 'note'>('none');
  const [urlInput, setUrlInput] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [lastSearchResults, setLastSearchResults] = useState<any[]>([]);
  const [indexingProgress, setIndexingProgress] = useState(0);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchDocuments();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      setSources(data.sources);
    } catch (e) {
      console.error('Failed to fetch documents');
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setIndexingProgress(10);
    setStatusMessage('Reading PDF data...');
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      setIndexingProgress(30);
      setStatusMessage('AI Extracting Text...');
      
      const extractionRes = await fetch('/api/ai/extract-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64 })
      });
      const extractionData = await extractionRes.json();
      const text = extractionData.text;
      if (!text) throw new Error(extractionData.error || 'Could not extract text');

      setIndexingProgress(50);
      setStatusMessage('Chunking Knowledge...');
      const chunks = chunkText(text, 1200);

      setIndexingProgress(70);
      setStatusMessage(`Embedding ${chunks.length} segments...`);
      
      const embedRes = await fetch('/api/ai/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunks, batch: true })
      });
      const embedData = await embedRes.json();
      const embeddings = embedData.embeddings || [];

      if (embeddings.length === 0) {
        throw new Error('Failed to generate embeddings');
      }

      setIndexingProgress(90);
      setStatusMessage('Syncing with Store...');
      
      await fetch('/api/store-chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: file.name,
          chunks: chunks.map((text, i) => ({
            id: `${file.name}-${i}-${Date.now()}`,
            text,
            embedding: (embeddings[i] || embeddings[0]).values
          }))
        })
      });

      setIndexingProgress(100);
      setStatusMessage(`Indexed ${chunks.length} chunks`);
      fetchDocuments();
      setTimeout(() => {
        setUploadMode('none');
        setIndexingProgress(0);
        setStatusMessage('');
      }, 1000);

    } catch (e: any) {
      console.error(e);
      setStatusMessage(`Error: ${e.message || 'Intake failed'}`);
      setIndexingProgress(0);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUrlAdd = async () => {
    if (!urlInput) return;
    setIsLoading(true);
    setStatusMessage('Scraping Content...');
    try {
      const scrapRes = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput }),
      });
      const { text } = await scrapRes.json();
      
      if (!text) throw new Error('Scrape failed');

      setStatusMessage('Embedding...');
      const chunks = chunkText(text, 1200);
      const embedRes = await fetch('/api/ai/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunks, batch: true })
      });
      const embedData = await embedRes.json();
      const embeddings = embedData.embeddings || [];

      await fetch('/api/store-chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: urlInput,
          chunks: chunks.map((text, i) => ({
            id: `${urlInput}-${i}`,
            text,
            embedding: (embeddings[i] || embeddings[0]).values
          }))
        })
      });

      setStatusMessage(`Indexed URL`);
      fetchDocuments();
      setUrlInput('');
      setUploadMode('none');
    } catch (e) {
      setStatusMessage('Failed to add URL');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNoteAdd = async () => {
    if (!noteTitle || !noteContent) return;
    setIsLoading(true);
    setStatusMessage('Indexing Note...');
    try {
      const chunks = chunkText(noteContent, 1200);
      const embedRes = await fetch('/api/ai/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunks, batch: true })
      });
      const embedData = await embedRes.json();
      const embeddings = embedData.embeddings || [];

      await fetch('/api/store-chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: noteTitle,
          chunks: chunks.map((text, i) => ({
            id: `${noteTitle}-${i}`,
            text,
            embedding: (embeddings[i] || embeddings[0]).values
          }))
        })
      });

      setStatusMessage('Note indexed');
      fetchDocuments();
      setNoteTitle('');
      setNoteContent('');
      setUploadMode('none');
    } catch (e) {
      setStatusMessage('Failed to save note');
    } finally {
      setIsLoading(false);
    }
  };

  const clearAll = async () => {
    if (!confirm('Clear knowledge base?')) return;
    await fetch('/api/clear-docs', { method: 'POST' });
    setSources([]);
    setMessages([]);
    setLastSearchResults([]);
    setStatusMessage('Cleared');
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    try {
      // 1. Get query embedding
      const embedRes = await fetch('/api/ai/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: [userMsg], batch: true })
      });
      const embedData = await embedRes.json();
      const queryEmbedding = embedData.embeddings?.[0]?.values;
      if (!queryEmbedding) throw new Error('Could not generate query embedding');

      // 2. Search for context on backend
      const searchRes = await fetch('/api/search-vector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedding: queryEmbedding }),
      });
      const searchData = await searchRes.json();
      setLastSearchResults(searchData.results);

      const context = searchData.results
        .map((r: any) => `[Source: ${r.source}]\n${r.text}`)
        .join('\n\n---\n\n');

      const foundSources = Array.from(new Set(searchData.results.map((r: any) => r.source))) as string[];

      // 3. Chat with AI
      const prompt = `
        You are a helpful study assistant. 
        Use the following context extracted from uploaded class notes, PDFs, and bookmarks to answer the student's question. 
        Always cite the source name in brackets [like this] when using information from the context.
        
        CONTEXT:
        ${context}
        
        QUESTION:
        ${userMsg}
      `;

      const chatRes = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const chatData = await chatRes.json();

      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: chatData.text || 'Sorry, I couldn\'t generate a response.',
        source: foundSources
      }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const generateSummary = async (docSource: string) => {
    setIsLoading(true);
    setStatusMessage(`Summarizing...`);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `Relevant context for ${docSource}` }),
      });
      const data = await res.json();
      const chunks = data.results.filter((r: any) => r.source === docSource);
      setLastSearchResults(chunks);
      
      const fullText = chunks.map((r: any) => r.text).join(' ');
      const prompt = `Provide a concise summary of this document: \n\n ${fullText.slice(0, 5000)}`;
      
      const chatRes = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const chatData = await chatRes.json();

      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `### Summary of ${docSource}\n\n${chatData.text}`,
        source: [docSource]
      }]);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  function chunkText(text: string, size: number): string[] {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    const sentences = cleanText.match(/[^.!?]+[.!?]+/g) || [cleanText];
    const chunks: string[] = [];
    let currentChunk = "";
    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > size) {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += (currentChunk ? " " : "") + sentence;
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks.filter(c => c.length > 50);
  }

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      {/* Sidebar: 260px, Dark */}
      <aside className="w-[260px] bg-[#111827] text-white flex flex-col border-r border-[#1F2937]">
        <div className="p-8">
          <h1 className="massive-header text-white">Study<br />Sense.</h1>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-4">Knowledge Base</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-2 space-y-8">
          {/* Documents Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Documents</h2>
              {sources.length > 0 && (
                <button onClick={clearAll} className="text-[10px] text-slate-500 hover:text-red-400 font-bold uppercase transition-colors">Reset</button>
              )}
            </div>
            <div className="space-y-3">
              {sources.map((s, idx) => {
                const isPdf = s.toLowerCase().endsWith('.pdf');
                return (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={idx} 
                    className="doc-item-theme group"
                  >
                    <span className="truncate mr-2 opacity-80 group-hover:opacity-100 transition-opacity">{s}</span>
                    <span className="tag-theme shrink-0">{isPdf ? 'PDF' : 'DOC'}</span>
                    <button 
                      onClick={() => generateSummary(s)}
                      className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-600 rounded px-1.5 py-0.5 text-[9px] uppercase font-black"
                    >Sum</button>
                  </motion.div>
                );
              })}
              {sources.length === 0 && (
                <p className="text-[11px] text-slate-500 italic px-2">No documents indexed.</p>
              )}
            </div>
          </div>

          {/* System Metrics */}
          <div className="pt-8 border-t border-white/5 space-y-4">
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Indexing status</div>
              <div className="text-2xl font-extrabold tracking-tighter">{sources.length} <span className="text-[10px] font-normal uppercase opacity-40 ml-1">Sources</span></div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-[10px] text-blue-400 font-bold flex items-center gap-1.5 uppercase">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                Gemini Connected
              </div>
              <div className="text-[10px] text-slate-500 font-bold flex items-center gap-1.5 uppercase">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                RAG Engine: Active
              </div>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="p-6 mt-auto">
          <button 
            onClick={() => setUploadMode('pdf')}
            className="w-full bg-[#3B82F6] hover:bg-blue-600 text-white font-bold py-4 rounded-xl text-[12px] uppercase tracking-widest shadow-xl shadow-blue-900/20 active:scale-[0.98] transition-all"
          >
            Upload New Source
          </button>
        </div>
      </aside>

      {/* Main Chat: 1fr, White */}
      <main className="flex-1 flex flex-col bg-white overflow-hidden relative">
        <div className="p-8 flex-1 overflow-y-auto space-y-8 flex flex-col">
          <div className="text-center">
            <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em]">Session active • {new Date().toLocaleDateString()}</span>
          </div>

          {messages.length === 0 && (
            <div className="my-auto max-w-xl mx-auto text-center space-y-4 opacity-40">
              <Search size={48} className="mx-auto text-slate-200" />
              <h2 className="text-2xl font-black uppercase tracking-tight text-slate-400">Knowledge Assistant</h2>
              <p className="text-sm font-medium leading-relaxed">System ready for semantic retrieval. Upload materials to begin session.</p>
            </div>
          )}

          <AnimatePresence>
            {messages.map((msg, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={msg.role === 'user' ? 'chat-bubble-user-theme' : 'chat-bubble-ai-theme'}>
                  <div className="whitespace-pre-wrap text-[15px] leading-relaxed prose prose-slate max-w-none">
                    {msg.content}
                  </div>
                  {msg.source && msg.source.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {msg.source.map((s, i) => (
                        <span key={i} className="citation-theme">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={chatEndRef} />
        </div>

        {/* Input bar */}
        <div className="p-8 border-t border-slate-100">
          <form onSubmit={handleSendMessage} className="max-w-3xl mx-auto flex gap-4 items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a follow-up question..."
              className="flex-1 bg-slate-100 rounded-full px-8 py-4 outline-none font-medium text-slate-600 focus:bg-slate-50 border-2 border-transparent focus:border-blue-100 transition-all text-sm"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="bg-[#3B82F6] text-white w-14 h-14 rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-all shadow-lg shadow-blue-500/20 disabled:grayscale"
            >
              <Send size={20} />
            </button>
          </form>
        </div>

        {/* Modals */}
        <AnimatePresence>
          {uploadMode !== 'none' && (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-white/95 backdrop-blur-md z-50 flex items-center justify-center p-8"
            >
              <div className="max-w-md w-full p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="massive-header text-slate-900 leading-tight">
                    {uploadMode === 'pdf' ? 'Index New Material' : 'Custom Note'}
                  </h3>
                  <button onClick={() => setUploadMode('none')} className="p-2 hover:bg-slate-100 rounded-full text-slate-400"><Trash2 size={24} /></button>
                </div>

                <div className="space-y-4">
                  {uploadMode === 'pdf' && (
                    <div className="border-4 border-dashed border-slate-200 rounded-3xl p-16 text-center hover:border-blue-500 hover:bg-blue-50 transition-all cursor-pointer relative group">
                      <input type="file" accept=".pdf" onChange={handlePdfUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                      <FileText className="mx-auto text-slate-200 group-hover:text-blue-200 mb-6" size={64} />
                      <p className="text-sm font-black uppercase tracking-widest text-slate-400 group-hover:text-blue-600 transition-colors">Drop PDF to Index</p>
                    </div>
                  )}
                  {uploadMode === 'note' && (
                      <div className="space-y-3">
                          <input type="text" placeholder="Note Title" value={noteTitle} onChange={e => setNoteTitle(e.target.value)} className="w-full bg-slate-100 p-4 rounded-xl outline-none font-bold text-sm" />
                          <textarea rows={6} placeholder="Content..." value={noteContent} onChange={e => setNoteContent(e.target.value)} className="w-full bg-slate-100 p-4 rounded-xl outline-none text-sm resize-none" />
                          <button onClick={handleNoteAdd} className="w-full bg-blue-600 text-white py-4 rounded-xl font-black uppercase text-xs tracking-widest">Index Note</button>
                      </div>
                  )}
                </div>

                {isLoading && (
                  <div className="space-y-4">
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${indexingProgress}%` }}
                        className="bg-blue-600 h-full"
                      />
                    </div>
                    <div className="flex items-center justify-center gap-4 text-slate-400 font-black uppercase text-[10px] tracking-[0.3em]">
                      <Loader2 className="animate-spin" size={20} />
                      <span>{statusMessage || 'Analyzing...'}</span>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Right Column: Contextual Sources: 240px */}
      <aside className="w-[240px] bg-slate-100 border-l border-slate-200 flex flex-col">
        <div className="p-6">
          <div className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-6">Contextual Sources</div>
          
          <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-200px)]">
            {lastSearchResults.length > 0 ? lastSearchResults.map((res, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className="bg-white p-4 rounded-xl shadow-sm border border-slate-200"
              >
                <div className="text-[10px] font-bold text-blue-600 mb-1 uppercase">Match {(res.similarity * 100).toFixed(0)}% Similarity</div>
                <div className="text-xs font-bold mb-1 truncate">{res.source}</div>
                <div className="text-[11px] text-slate-500 leading-relaxed italic line-clamp-3">"{res.text}"</div>
              </motion.div>
            )) : (
              <div className="py-12 text-center">
                <Search size={24} className="mx-auto text-slate-300 mb-2 opacity-50" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Awaiting Queries</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto p-6 space-y-4">
          <div className="bg-slate-800 text-white p-5 rounded-2xl shadow-xl">
             <div className="text-[10px] font-black opacity-40 uppercase tracking-widest mb-3">System Health</div>
             <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]"></div>
                <span className="text-[11px] font-bold">GPT-4o Ready</span>
             </div>
             <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]"></div>
                <span className="text-[11px] font-bold">Vector DB: Connected</span>
             </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
