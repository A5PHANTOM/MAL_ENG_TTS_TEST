import { useState, useRef, useEffect } from 'react';
import { PipecatClient } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import './App.css';

interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: Date;
}

function App() {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [liveTranscript, setLiveTranscript] = useState<string | null>(null);
  const [inputText, setInputText] = useState<string>('');
  const [isThinking, setIsThinking] = useState<boolean>(false);

  const clientRef = useRef<PipecatClient | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveTranscript, isThinking]);

  const connect = async () => {
    try {
      setStatus('connecting');
      setError(null);
      console.log("Starting connection process...");

      // Use the non-deprecated transport configuration
      const transport = new SmallWebRTCTransport({
        webrtcRequestParams: {
          endpoint: "http://localhost:8000/offer"
        }
      });
      
      const client = new PipecatClient({
        transport: transport,
        enableMic: true,
      });
      clientRef.current = client;

      // Track listener (handles playback since setAudioElement is removed in new client-js version)
      client.on("trackStarted", (track: MediaStreamTrack) => {
        console.log("Track started:", track.kind);
        if (track.kind === "audio") {
          const audioElement = document.createElement("audio");
          audioElement.srcObject = new MediaStream([track]);
          audioElement.autoplay = true;
          audioElement.playsInline = true;
          document.body.appendChild(audioElement);

          // Cleanup when track ends
          track.onended = () => {
            audioElement.remove();
          };
        }
      });

      // Listen for connection events
      client.on("connected", () => {
        setStatus('connected');
        console.log("Client connected event received");
        // Welcome message
        setMessages([
          {
            id: 'welcome',
            sender: 'bot',
            text: 'Hello! I am ready to talk or chat. Speak or type in Malayalam or English!',
            timestamp: new Date()
          }
        ]);
      });

      client.on("disconnected", () => {
        setStatus('disconnected');
        console.log("Client disconnected event received");
      });

      client.on("error", (err: any) => {
        console.error("Client error event received:", err);
        const errorMsg = err?.detail || err?.message || JSON.stringify(err);
        setError(`Connection error: ${errorMsg}`);
        setStatus('error');
      });

      // Speech-to-text live transcription
      client.on("userTranscript", (data: any) => {
        console.log("User transcript:", data);
        if (data.final) {
          setLiveTranscript(null);
          if (data.text.trim()) {
            setMessages((prev) => [
              ...prev,
              {
                id: Math.random().toString(36).substring(7),
                sender: 'user',
                text: data.text.trim(),
                timestamp: new Date()
              }
            ]);
          }
        } else {
          setLiveTranscript(data.text);
        }
      });

      // Bot LLM streaming events
      client.on("botLlmStarted", () => {
        setIsThinking(true);
        // Insert empty bot message bubble to stream tokens into
        const botMsgId = "bot-" + Math.random().toString(36).substring(7);
        setMessages((prev) => [
          ...prev,
          {
            id: botMsgId,
            sender: 'bot',
            text: '',
            timestamp: new Date()
          }
        ]);
      });

      client.on("botLlmText", (data: any) => {
        setIsThinking(false);
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].sender === 'bot') {
              next[i].text += data.text;
              break;
            }
          }
          return next;
        });
      });

      client.on("botLlmStopped", () => {
        setIsThinking(false);
      });

      // Connect to the backend
      console.log("Calling client.connect()...");
      await client.connect();
      console.log("client.connect() call finished");

    } catch (err) {
      console.error("Failed to connect catch block:", err);
      setError(err instanceof Error ? err.message : "Failed to connect");
      setStatus('error');
    }
  };

  const disconnect = async () => {
    if (clientRef.current) {
      console.log("Disconnecting...");
      await clientRef.current.disconnect();
      clientRef.current = null;
      setStatus('disconnected');
      setLiveTranscript(null);
      setIsThinking(false);
    }
  };

  const sendTextMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !clientRef.current || status !== 'connected') return;

    const userText = inputText.trim();
    setInputText('');

    // Append user's typed message immediately to chat history
    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(7),
        sender: 'user',
        text: userText,
        timestamp: new Date()
      }
    ]);

    try {
      // Send text to the bilingual AI agent
      await clientRef.current.sendText(userText);
    } catch (err) {
      console.error("Failed to send text message:", err);
      setError("Failed to send message");
    }
  };

  return (
    <div className="container">
      <header className="chat-header">
        <div className="header-info">
          <h1>MAL_ENG AI Agent</h1>
          <p>Malayalam & English Bilingual Assistant</p>
        </div>
        <div className="status-and-action">
          <div className="status-badge">
            <div className={`status-indicator ${status}`}></div>
            <span>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
          </div>
          {status === 'disconnected' || status === 'error' ? (
            <button className="connect-btn action-btn" onClick={connect}>
              Start Conversation
            </button>
          ) : (
            <button className="disconnect-btn action-btn" onClick={disconnect}>
              End Call
            </button>
          )}
        </div>
      </header>

      {error && <div className="error-message">{error}</div>}

      <main className="chat-box-container">
        <div className="messages-list">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">🤖</div>
              <h3>Malayalam - English Voice & Text Assistant</h3>
              <p>Click "Start Conversation" above to start talking or typing. Speak in Malayalam or English, and I will reply in the same language.</p>
            </div>
          )}
          
          {messages.map((msg) => (
            <div key={msg.id} className={`message-wrapper ${msg.sender}`}>
              <div className="message-avatar">
                {msg.sender === 'user' ? '👤' : '🤖'}
              </div>
              <div className="message-bubble-container">
                <div className="message-bubble">
                  {msg.text || (isThinking && msg.id.startsWith('bot-') ? (
                    <div className="thinking-dots">
                      <span></span><span></span><span></span>
                    </div>
                  ) : null)}
                </div>
                <span className="message-time">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}

          {/* Live speech transcription ghost bubble */}
          {liveTranscript && (
            <div className="message-wrapper user live-transcript">
              <div className="message-avatar">👤</div>
              <div className="message-bubble-container">
                <div className="message-bubble">
                  <em>{liveTranscript}</em>
                  <span className="live-badge">Speaking...</span>
                </div>
              </div>
            </div>
          )}

          {/* Thinking loader when waiting for LLM */}
          {isThinking && !messages.some(m => m.sender === 'bot' && !m.text) && (
            <div className="message-wrapper bot thinking">
              <div className="message-avatar">🤖</div>
              <div className="message-bubble-container">
                <div className="message-bubble">
                  <div className="thinking-dots">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {status === 'connected' && (
          <form className="chat-input-panel" onSubmit={sendTextMessage}>
            <input
              type="text"
              placeholder="Type in Malayalam or English..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="chat-input-field"
            />
            <button type="submit" className="send-msg-btn" disabled={!inputText.trim()}>
              Send
            </button>
            <div className="voice-mic-indicator pulse">
              <div className="mic-wave"></div>
              <span>Mic Active</span>
            </div>
          </form>
        )}
      </main>

      {/* Audio playback is handled dynamically in trackStarted event */}
    </div>
  );
}

export default App;
